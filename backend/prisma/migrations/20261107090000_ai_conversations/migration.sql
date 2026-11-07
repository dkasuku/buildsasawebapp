-- Saved Buildsasa AI chats (history in the AI page).
CREATE TABLE IF NOT EXISTS "AiConversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "messages" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt");
