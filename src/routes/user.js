import { verifyToken } from "../middleware/authMiddleware.js";

export default async function userRoutes(fastify, options) {

    fastify.get("/profile", {
        preHandler: verifyToken
    }, async (request, reply) => {

        return {
            success: true,
            message: "Protected route accessed ✅",
            user: request.user
        };

    });

}