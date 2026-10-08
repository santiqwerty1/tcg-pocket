/** Notificaciones (Fase 18): Web Push on this device and what to send. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import { type NotificationKind, notificationsSchema } from './schemas'

const key = ['notifications'] as const

export function useNotifications() {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request('/api/notifications', { schema: notificationsSchema, signal }),
  })
}

export function useNotificationPreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Record<NotificationKind, boolean>>) =>
      request('/api/notifications/preferences', { method: 'PUT', body: patch }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export function useTestNotification() {
  return useMutation({
    mutationFn: () => request('/api/notifications/test', { method: 'POST', schema: z.object({ sent: z.number() }) }),
  })
}

/** VAPID public key (base64url) → the bytes `pushManager.subscribe` wants. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  )
}

/** This device's subscription, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) ?? null
}

/** Asks permission, subscribes this device and tells the server. */
export async function subscribeThisDevice(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('El navegador no dio permiso para notificaciones.')
  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await request('/api/notifications/subscribe', {
    method: 'POST',
    body: { endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent.slice(0, 300) },
  })
}

export async function unsubscribeThisDevice(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  await request('/api/notifications/subscribe', { method: 'DELETE', body: { endpoint: subscription.endpoint } })
  await subscription.unsubscribe()
}
