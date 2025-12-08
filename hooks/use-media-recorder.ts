"use client"

import { useState, useRef, useCallback } from "react"

export function useMediaRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [mediaBlob, setMediaBlob] = useState<Blob | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaRecorderRef.current = new MediaRecorder(stream)
      chunksRef.current = []

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" })
        setMediaBlob(blob)
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorderRef.current.start()
      setIsRecording(true)
      setMediaBlob(null)
    } catch (error) {
      console.error("Error accessing microphone:", error)
      alert("Không thể truy cập microphone. Vui lòng kiểm tra quyền truy cập.")
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }, [])

  const clearRecording = useCallback(() => {
    setMediaBlob(null)
    chunksRef.current = []
  }, [])

  return {
    isRecording,
    mediaBlob,
    startRecording,
    stopRecording,
    clearRecording
  }
}
