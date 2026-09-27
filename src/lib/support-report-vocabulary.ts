/** Client-safe support report vocabulary shared by the registry, query service and dashboard. */
export const SUPPORT_CATEGORIES = ["ACCOUNT_ACCESS", "PAYMENT_ORDER", "COURSE_CONTENT", "ASSESSMENT_RESULT", "CERTIFICATE", "TECHNICAL_PROBLEM", "OTHER"] as const;
export const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const SUPPORT_QUEUES = ["GENERAL_SUPPORT", "ACCOUNTS", "FINANCE", "LEARNING_ASSESSMENT", "TECHNICAL"] as const;
export const SUPPORT_STATUSES = ["NEW", "OPEN", "ASSIGNED", "ESCALATED", "RESOLVED", "CLOSED"] as const;
/** Pseudo-status for the current backlog: every ticket not yet resolved or closed. */
export const SUPPORT_BACKLOG_STATUS = "OPEN_BACKLOG";
/** Owner filter sentinel for tickets with no assignee. */
export const SUPPORT_UNASSIGNED_OWNER = "UNASSIGNED";
