import jwt from "jsonwebtoken";

export const verifyToken = async (request, reply) => {
    try {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return reply.status(401).send({
                success: false,
                message: "Unauthorized - No token provided",
            });
        }

        const token = authHeader.split(" ")[1];

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        request.user = decoded;

    } catch (error) {

        console.log("JWT ERROR:", error.message);

        // 🔥 Better error handling
        if (error.name === "TokenExpiredError") {
            return reply.status(401).send({
                success: false,
                message: "Token expired - please login again",
            });
        }

        if (error.name === "JsonWebTokenError") {
            return reply.status(401).send({
                success: false,
                message: "Invalid token",
            });
        }

        return reply.status(401).send({
            success: false,
            message: "Unauthorized",
        });
    }
};