import { LogOutIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { useChangePassword, useLogout, useMe } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Field, KeyValue, Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SessionPage() {
  const me = useMe()
  const logout = useLogout()
  const changePassword = useChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (next !== confirm) {
      toast.error('Las contraseñas nuevas no coinciden.')
      return
    }
    try {
      await changePassword.mutateAsync({ currentPassword: current, newPassword: next })
      toast.success('Contraseña cambiada')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Cuenta">
        {me.isPending ? <LoadingRows rows={2} /> : null}
        {me.isError ? <ErrorState error={me.error} onRetry={() => me.refetch()} /> : null}
        {me.data ? (
          <KeyValue
            items={[
              { label: 'Email', value: me.data.email },
              {
                label: 'TOTP',
                value: me.data.totpEnabled ? (
                  <Badge variant="secondary">activado</Badge>
                ) : (
                  <Badge variant="outline">desactivado</Badge>
                ),
              },
            ]}
          />
        ) : null}
        <Button variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending}>
          {logout.isPending ? <Spinner /> : <LogOutIcon data-icon="inline-start" />}
          Cerrar sesión
        </Button>
      </Section>

      <Section title="Cambiar contraseña">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Contraseña actual" htmlFor="password-current">
            <Input
              id="password-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              required
            />
          </Field>
          <Field label="Contraseña nueva" htmlFor="password-next">
            <Input
              id="password-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              required
              minLength={8}
            />
          </Field>
          <Field label="Repetir la nueva" htmlFor="password-confirm">
            <Input
              id="password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
              minLength={8}
            />
          </Field>
          <Button type="submit" disabled={changePassword.isPending}>
            {changePassword.isPending ? <Spinner /> : null}
            Cambiar
          </Button>
        </form>
      </Section>
    </div>
  )
}
