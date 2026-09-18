import { z } from "zod";

import { TICKET_PRIORITIES, TICKET_STATUSES, USER_ROLES } from "@/lib/constants";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createTicketSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "Title must be at least 5 characters")
    .max(160, "Title is too long"),
  description: z
    .string()
    .trim()
    .min(10, "Please describe the issue in at least 10 characters")
    .max(5000, "Description is too long"),
  categoryId: z.string().uuid("Select a category"),
  priority: z.enum(TICKET_PRIORITIES as [string, ...string[]]),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const commentSchema = z.object({
  ticketId: z.string().uuid(),
  message: z.string().trim().min(1, "Message cannot be empty").max(5000),
});

export const attachmentSchema = z.object({
  ticketId: z.string().uuid(),
  commentId: z.string().uuid().nullable().optional(),
  fileName: z.string().trim().min(1).max(255),
  filePath: z.string().trim().min(1),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().trim().min(1),
});

export const ticketUpdateSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(TICKET_STATUSES as [string, ...string[]]).optional(),
  priority: z.enum(TICKET_PRIORITIES as [string, ...string[]]).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

export const categorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Name is required").max(60),
  description: z.string().trim().max(240).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export const departmentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Name is required").max(60),
});

export const createUserSchema = z.object({
  fullName: z.string().trim().min(3, "Full name is required").max(120),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(USER_ROLES as [string, ...string[]]),
  departmentId: z.string().uuid().nullable().optional(),
});

export const updateUserSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(3).max(120).optional(),
  role: z.enum(USER_ROLES as [string, ...string[]]).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(3, "Full name is required").max(120),
});
