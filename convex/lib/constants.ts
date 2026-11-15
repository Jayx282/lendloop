import { v, type Infer } from "convex/values";

// Shared by the Convex functions and the Next.js UI, so labels and limits
// cannot drift apart.

export const CATEGORIES = [
  { value: "power-tools", label: "Power tools" },
  { value: "hand-tools", label: "Hand tools" },
  { value: "garden", label: "Garden" },
  { value: "kitchen", label: "Kitchen" },
  { value: "camping", label: "Camping" },
  { value: "cleaning", label: "Cleaning" },
  { value: "other", label: "Other" },
] as const;

export const CONDITIONS = [
  { value: "like-new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "worn", label: "Well used" },
] as const;

export const categoryValidator = v.union(
  v.literal("power-tools"),
  v.literal("hand-tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("other"),
);
export type Category = Infer<typeof categoryValidator>;

export const conditionValidator = v.union(
  v.literal("like-new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);
export type Condition = Infer<typeof conditionValidator>;

export const roleValidator = v.union(v.literal("admin"), v.literal("user"));
export type Role = Infer<typeof roleValidator>;

// requested -> approved -> returned
//           -> declined
//           -> cancelled (by the borrower, also allowed after approval and before the start date)
export const loanStatusValidator = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);
export type LoanStatus = Infer<typeof loanStatusValidator>;

// Events Convex sends to the n8n "request notification" workflow.
export const loanEventTypeValidator = v.union(
  v.literal("loan.requested"),
  v.literal("loan.approved"),
  v.literal("loan.declined"),
  v.literal("loan.cancelled"),
  v.literal("loan.returned"),
);
export type LoanEventType = Infer<typeof loanEventTypeValidator>;

export const LIMITS = {
  toolName: { min: 2, max: 60 },
  description: { max: 280 },
  note: { max: 280 },
  displayName: { max: 40 },
  activeListingsPerUser: 25,
  openRequestsPerBorrower: 10,
  maxLoanDays: 30,
  maxDaysAhead: 180,
} as const;

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function conditionLabel(value: string): string {
  return CONDITIONS.find((c) => c.value === value)?.label ?? value;
}
