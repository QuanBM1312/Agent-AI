import { redirect } from "next/navigation"
import { getCurrentUserWithRole } from "@/lib/auth-utils"

export default async function Home() {
  const user = await getCurrentUserWithRole()

  if (!user) {
    // If no user, Clerk layout handles the sign-in
    // But we might want to show a splash or similar
    // For now, let's just let it be. 
    // Usually getCurrentUserWithRole is called within layouts/pages.
  }

  // Redirect to chat by default
  redirect("/chat")
}
