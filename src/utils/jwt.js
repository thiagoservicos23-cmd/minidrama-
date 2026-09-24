const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "dev-secret-troque-em-producao";

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: "30d" });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
