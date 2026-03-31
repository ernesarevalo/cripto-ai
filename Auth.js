import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "btc-oracle-secret-2025";

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

/** Express middleware — pone req.user o devuelve 401 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "no_token" });
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: "invalid_token" });
  req.user = user;
  next();
}

/** Middleware — solo admin */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin")
    return res.status(403).json({ error: "forbidden" });
  next();
}