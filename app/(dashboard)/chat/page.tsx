import { redirect } from "next/navigation"
import { v4 as uuidv4 } from "uuid"

export default function ChatPage() {
  const newSessionId = uuidv4()
  redirect(`/chat/${newSessionId}`)
}
