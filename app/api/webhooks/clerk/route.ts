import { verifyWebhook } from "@clerk/backend/webhooks";
import { prisma } from "@/lib/prisma";
import { deleteClerkUser, upsertClerkUser } from "@/lib/clerk-user-sync";

function getWebhookSecret() {
  return (
    process.env.CLERK_WEBHOOK_SIGNING_SECRET ||
    process.env.CLERK_WEBHOOK_SECRET ||
    ""
  );
}

export async function POST(req: Request) {
  const signingSecret = getWebhookSecret();

  if (!signingSecret) {
    return new Response("Missing Clerk webhook signing secret", { status: 500 });
  }

  let evt;

  try {
    evt = await verifyWebhook(req, { signingSecret });
  } catch (error) {
    console.error("[clerk-webhook] verification failed", error);
    return new Response("Webhook verification failed", { status: 400 });
  }

  try {
    switch (evt.type) {
      case "user.created":
      case "user.updated": {
        await upsertClerkUser(prisma, {
          id: evt.data.id,
          emailAddresses: evt.data.email_addresses,
          firstName: evt.data.first_name,
          lastName: evt.data.last_name,
          publicMetadata:
            evt.data.public_metadata &&
            typeof evt.data.public_metadata === "object"
              ? (evt.data.public_metadata as Record<string, unknown>)
              : null,
        });
        break;
      }
      case "user.deleted": {
        const deletedUserId = typeof evt.data.id === "string" ? evt.data.id.trim() : "";
        if (deletedUserId) {
          await deleteClerkUser(prisma, deletedUserId);
        }
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("[clerk-webhook] sync failed", {
      eventType: evt.type,
      message: error instanceof Error ? error.message : String(error),
    });
    return new Response("Webhook sync failed", { status: 500 });
  }

  return new Response("", { status: 200 });
}
