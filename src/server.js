

// src/server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
// ⚠️ Đổi tên import để tránh trùng
import { db as fbDb, auth as fbAuth } from "./firebase.js";
// ở đầu file (cạnh các import khác)
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
// tính __dirname cho ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// trỏ tới thư mục public
const publicDir = path.join(__dirname, "..", "public");

const app = express();
const PORT = process.env.PORT || 8080;

// serve file tĩnh (index.html, js, css, ảnh,...)
app.use(express.static(publicDir, { extensions: ["html"] }));

// Route trang chủ → trả index.html
app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
});
// ===== Middlewares chung =====
app.use(helmet());
import corsMiddleware from "cors";

const ALLOWED_ORIGINS = [
    // điền domain thật của bạn tại đây khi có
    "http://localhost:5173",
    "http://127.0.0.1:5500",
    "https://kimluandev.github.io/Greedy/",
];

// Cho phép mở file HTML trực tiếp trong DEV (Origin = null)
const allowNullOriginInDev = true;

app.use(
    corsMiddleware({
        origin(origin, cb) {
            if (!origin && allowNullOriginInDev) return cb(null, true);
            const ok = ALLOWED_ORIGINS.includes(origin);
            cb(ok ? null : new Error("Not allowed by CORS"));
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    })
);




app.use(express.json());
app.use(morgan("tiny"));

// ===== Tham chiếu các collection/doc =====
const usersCol = fbDb.collection("users");                // users/{uid}
const roundsCol = fbDb.collection("rounds");               // rounds/{roundId} (tuỳ bạn xài sau)
const jackpotDoc = fbDb.collection("jackpot").doc("global");// jackpot/global

// ===== Helper nhỏ =====
function shortId() {
    return Math.random().toString(36).slice(2, 10); // ID ngắn public để chuyển xu
}

// Middleware xác thực Firebase ID token (Bearer <token>)
async function verifyIdToken(req, res, next) {
    try {
        const authz = req.headers.authorization || "";
        const token = authz.startsWith("Bearer ") ? authz.slice(7) : null;
        if (!token) return res.status(401).json({ error: "Missing token" });

        const decoded = await fbAuth.verifyIdToken(token);
        req.user = { uid: decoded.uid, email: decoded.email || null };
        next();
    } catch (e) {
        console.error("verifyIdToken error:", e);
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}

// ======= ROUTES =======

// 0) Health check
app.get("/", (_req, res) => res.send("Greedy backend up ✅"));

// 1) Khởi tạo / cập nhật hồ sơ người dùng (gọi sau khi client đăng nhập)
app.post("/me/init", verifyIdToken, async (req, res) => {
    try {
        const { userName = "Player", avatar = "" } = req.body || {};
        const ref = usersCol.doc(req.user.uid);

        await fbDb.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) {
                tx.set(ref, {
                    userName,
                    avatar,
                    userId: shortId(), // public short id
                    balance: 0,
                    profit: 0,
                    loss: 0,
                    createdAt: new Date()
                });
            } else {
                tx.update(ref, { userName, avatar });
            }
        });

        const fresh = await ref.get();
        return res.json({ uid: req.user.uid, ...fresh.data() });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "init failed" });
    }
});

// 2) Lấy hồ sơ người dùng
app.get("/me", verifyIdToken, async (req, res) => {
    try {
        const snap = await usersCol.doc(req.user.uid).get();
        if (!snap.exists) return res.status(404).json({ error: "User not found" });
        return res.json({ uid: req.user.uid, ...snap.data() });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "get me failed" });
    }
});

// 3) Nạp xu (demo)
app.post("/wallet/deposit", verifyIdToken, async (req, res) => {
    try {
        const amount = Number(req.body?.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

        const ref = usersCol.doc(req.user.uid);
        await fbDb.runTransaction(async (tx) => {
            const s = await tx.get(ref);
            if (!s.exists) throw new Error("User not found");
            const bal = (s.data().balance || 0) + amount;
            tx.update(ref, { balance: bal });
        });

        const fresh = await ref.get();
        return res.json({ balance: fresh.data().balance });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "deposit failed" });
    }
});

// 4) Rút xu (demo)
app.post("/wallet/withdraw", verifyIdToken, async (req, res) => {
    try {
        const amount = Number(req.body?.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

        const ref = usersCol.doc(req.user.uid);
        await fbDb.runTransaction(async (tx) => {
            const s = await tx.get(ref);
            if (!s.exists) throw new Error("User not found");
            const cur = s.data().balance || 0;
            if (cur < amount) throw new Error("Insufficient balance");
            tx.update(ref, { balance: cur - amount });
        });

        const fresh = await ref.get();
        return res.json({ balance: fresh.data().balance });
    } catch (e) {
        console.error(e);
        const msg = String(e).includes("Insufficient") ? "Insufficient balance" : "withdraw failed";
        return res.status(400).json({ error: msg });
    }
});

// 5) Chuyển xu theo userId (ID ngắn public)
app.post("/wallet/transfer", verifyIdToken, async (req, res) => {
    try {
        const { toUserId, amount } = req.body || {};
        const amt = Number(amount || 0);
        if (!toUserId || !Number.isFinite(amt) || amt <= 0) {
            return res.status(400).json({ error: "Invalid params" });
        }

        const fromRef = usersCol.doc(req.user.uid);

        // tìm recipient theo userId public
        const q = await usersCol.where("userId", "==", toUserId).limit(1).get();
        if (q.empty) return res.status(404).json({ error: "Recipient not found" });
        const toRef = q.docs[0].ref;

        await fbDb.runTransaction(async (tx) => {
            const [fs, ts] = await Promise.all([tx.get(fromRef), tx.get(toRef)]);
            if (!fs.exists || !ts.exists) throw new Error("User not found");

            const fb = fs.data().balance || 0;
            const tb = ts.data().balance || 0;
            if (fb < amt) throw new Error("Insufficient balance");

            tx.update(fromRef, { balance: fb - amt });
            tx.update(toRef, { balance: tb + amt });

            // ghi lịch sử chuyển cơ bản
            tx.create(fromRef.collection("transfers").doc(), {
                type: "send",
                toUserId,
                amount: amt,
                at: new Date()
            });
            tx.create(toRef.collection("transfers").doc(), {
                type: "receive",
                fromUserId: fs.data().userId,
                amount: amt,
                at: new Date()
            });
        });

        const fresh = await fromRef.get();
        return res.json({ balance: fresh.data().balance });
    } catch (e) {
        console.error(e);
        const msg = String(e).includes("Insufficient") ? "Insufficient balance" : "transfer failed";
        return res.status(400).json({ error: msg });
    }
});

// 6) Ghi 1 lần cược + cập nhật số dư/lãi/lỗ
app.post("/bets/record", verifyIdToken, async (req, res) => {
    try {
        const { roundId, betName, amount, result, payout } = req.body || {};
        const amt = Number(amount || 0);
        const pay = Number(payout || 0);
        if (!roundId || !betName || amt < 0) return res.status(400).json({ error: "Invalid params" });

        const userRef = usersCol.doc(req.user.uid);
        const betRef = userRef.collection("bets").doc();

        await fbDb.runTransaction(async (tx) => {
            const u = await tx.get(userRef);
            if (!u.exists) throw new Error("User not found");

            const data = u.data();
            const delta = -amt + pay; // -đặt + trả
            const newB = (data.balance || 0) + delta;
            if (newB < 0) throw new Error("Insufficient balance");

            tx.update(userRef, {
                balance: newB,
                profit: (data.profit || 0) + Math.max(delta, 0),
                loss: (data.loss || 0) + Math.max(-delta, 0)
            });

            tx.set(betRef, {
                roundId, betName, amount: amt, result, payout: pay, at: new Date()
            });
        });

        return res.json({ ok: true });
    } catch (e) {
        console.error(e);
        const msg = String(e).includes("Insufficient") ? "Insufficient balance" : "record bet failed";
        return res.status(400).json({ error: msg });
    }
});

// 7) Lịch sử cược
app.get("/history/bets", verifyIdToken, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit || 50), 200);
        const q = await usersCol
            .doc(req.user.uid)
            .collection("bets")
            .orderBy("at", "desc")
            .limit(limit)
            .get();

        return res.json(q.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "fetch history failed" });
    }
});

// 8) Jackpot (global)
app.get("/jackpot", async (_req, res) => {
    try {
        const s = await jackpotDoc.get();
        if (!s.exists) {
            await jackpotDoc.set({ amount: 0, updatedAt: new Date() });
            return res.json({ amount: 0 });
        }
        return res.json({ amount: s.data().amount || 0 });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "get jackpot failed" });
    }
});

app.post("/jackpot/contribute", verifyIdToken, async (req, res) => {
    try {
        const amount = Number(req.body?.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

        await fbDb.runTransaction(async (tx) => {
            const s = await tx.get(jackpotDoc);
            const curr = s.exists ? (s.data().amount || 0) : 0;
            tx.set(jackpotDoc, {
                amount: curr + amount,
                updatedAt: new Date()
            }, { merge: true });
        });

        const fresh = await jackpotDoc.get();
        return res.json({ amount: fresh.data().amount });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "contribute failed" });
    }
});

// ===== Khởi động server =====
app.listen(PORT, () => {
    console.log("Server listening on http://localhost:" + PORT);
});
