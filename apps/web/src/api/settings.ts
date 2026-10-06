import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import { settingsSchema, settingValueSchema, type UiSettings, uiSettingsSchema } from './schemas'

export const settingsKeys = {
  all: ['settings'] as const,
}

const UI_KEY = 'ui'
const LOCAL_UI_KEY = 'tcg.ui'

const DEFAULT_UI: UiSettings = { thumbnails: false }

function readLocalUi(): UiSettings {
  try {
    const raw = localStorage.getItem(LOCAL_UI_KEY)
    if (!raw) return DEFAULT_UI
    const parsed = uiSettingsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULT_UI
  } catch {
    return DEFAULT_UI
  }
}

function writeLocalUi(value: UiSettings): void {
  try {
    localStorage.setItem(LOCAL_UI_KEY, JSON.stringify(value))
  } catch {
    // Storage may be unavailable; the server copy is the source of truth anyway.
  }
}

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: ({ signal }) => request('/api/settings', { schema: settingsSchema, signal }),
    staleTime: 5 * 60_000,
  })
}

/** UI preferences stored under the `ui` key; the local copy makes them instant on reload. */
export function useUiSettings(): UiSettings {
  const settings = useSettings()
  const remote = settings.data ? uiSettingsSchema.safeParse(settings.data[UI_KEY] ?? {}) : null
  if (remote?.success) {
    writeLocalUi(remote.data)
    return remote.data
  }
  return readLocalUi()
}

export function useSetSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      request(`/api/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: { value },
        schema: settingValueSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.all }),
  })
}

export function useSetUiSettings() {
  const current = useUiSettings()
  const setSetting = useSetSetting()
  return {
    ...setSetting,
    update: (patch: Partial<UiSettings>) => {
      const next = { ...current, ...patch }
      writeLocalUi(next)
      return setSetting.mutateAsync({ key: UI_KEY, value: next })
    },
  }
}
