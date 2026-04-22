import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { query } from "../config/db.js";

export default async function authRoutes(fastify, options) {

    // =========================
    // SCHEMA VALIDATION
    // =========================
    const registerSchema = {
        body: {
            type: "object",
            required: ["name", "email", "password", "phone"],
            properties: {
                name: {
                    type: "string",
                    minLength: 3,
                    maxLength: 50,
                    pattern: "^[a-zA-Z\\s]+$"
                },
                email: {
                    type: "string",
                    format: "email",
                    maxLength: 100
                },
                password: {
                    type: "string",
                    minLength: 6,
                    maxLength: 100
                },
                phone: {
                    type: "string",
                    minLength: 10,
                    maxLength: 15
                },
                company: {
                    type: "string",
                    maxLength: 100
                }
            }
        }
    };

    const loginSchema = {
        body: {
            type: "object",
            required: ["email", "password"],
            properties: {
                email: { type: "string", format: "email" },
                password: { type: "string", minLength: 6 }
            }
        }
    };

    // =========================
    // REGISTER
    // =========================
    fastify.post("/register", { schema: registerSchema }, async (request, reply) => {
        const { name, email, password, phone, company } = request.body;

        try {
            // =========================
            // NORMALIZE
            // =========================
            const normalizedEmail = email.toLowerCase().trim();
            const trimmedName = name.trim();
            const trimmedPhone = phone.trim();
            const trimmedCompany = company ? company.trim() : null;

            // =========================
            // EXTRA VALIDATION (STRONG)
            // =========================

            // NAME
            if (!/^[a-zA-Z\s]{3,50}$/.test(trimmedName)) {
                return reply.status(400).send({
                    success: false,
                    message: "Name must be 3-50 characters and only letters"
                });
            }

            // EMAIL
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
            if (!emailRegex.test(normalizedEmail)) {
                return reply.status(400).send({
                    success: false,
                    message: "Invalid email format"
                });
            }

            // PHONE (INDIA)
            const phoneRegex = /^[6-9]\d{9}$/;
            if (!phoneRegex.test(trimmedPhone)) {
                return reply.status(400).send({
                    success: false,
                    message: "Invalid Indian mobile number"
                });
            }

            // PASSWORD (STRONG)
            const passwordRegex =
                /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{6,}$/;

            if (!passwordRegex.test(password)) {
                return reply.status(400).send({
                    success: false,
                    message:
                        "Password must include uppercase, lowercase, number & special character"
                });
            }

            // =========================
            // CHECK USER
            // =========================
            const existingUser = await query(
                "SELECT id FROM users WHERE email = $1",
                [normalizedEmail]
            );

            if (existingUser.rows.length > 0) {
                return reply.status(409).send({
                    success: false,
                    message: "User already exists"
                });
            }

            // =========================
            // HASH PASSWORD
            // =========================
            const hashedPassword = await bcrypt.hash(password, 12);

            // =========================
            // INSERT USER
            // =========================
            const result = await query(
                `INSERT INTO users (name, email, password, phone, company)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, name, email, phone, company, created_at`,
                [
                    trimmedName,
                    normalizedEmail,
                    hashedPassword,
                    trimmedPhone,
                    trimmedCompany
                ]
            );

            return reply.status(201).send({
                success: true,
                message: "User registered successfully",
                user: result.rows[0]
            });

        } catch (error) {
            console.error("Register Error:", error);

            if (error.code === "23505") {
                return reply.status(409).send({
                    success: false,
                    message: "Email already exists"
                });
            }

            return reply.status(500).send({
                success: false,
                message: "Internal Server Error"
            });
        }
    });

    // =========================
    // LOGIN
    // =========================
    fastify.post("/login", { schema: loginSchema }, async (request, reply) => {
        const { email, password } = request.body;

        try {
            const normalizedEmail = email.toLowerCase().trim();

            // =========================
            // FIND USER
            // =========================
            const result = await query(
                "SELECT * FROM users WHERE email = $1",
                [normalizedEmail]
            );

            if (result.rows.length === 0) {
                return reply.status(401).send({
                    success: false,
                    message: "Invalid credentials"
                });
            }

            const user = result.rows[0];

            // =========================
            // CHECK PASSWORD
            // =========================
            const isMatch = await bcrypt.compare(password, user.password);

            if (!isMatch) {
                return reply.status(401).send({
                    success: false,
                    message: "Invalid credentials"
                });
            }

            // =========================
            // GENERATE TOKEN
            // =========================
            const token = jwt.sign(
                { id: user.id, email: user.email },
                process.env.JWT_SECRET,
                { expiresIn: "7d" }
            );

            return reply.send({
                success: true,
                message: "Login successful",
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    company: user.company
                }
            });

        } catch (error) {
            console.error("Login Error:", error);

            return reply.status(500).send({
                success: false,
                message: "Internal Server Error"
            });
        }
    });
}