import { useQuery } from '@tanstack/react-query'
import { request } from '@/api/client'
import { healthSchema } from '@/api/schemas'
import { KeyValue, Section } from '@/components/Section'
import { useBrowserEngine } from '@/engine/browserEngine'
import { ENGINE_BASE } from '@/engine/protocol'
import { shortSha } from '@/lib/format'

export function AboutPage() {
  const health = useQuery({
    queryKey: ['healthz'],
    queryFn: ({ signal }) => request('/healthz', { schema: healthSchema, signal }),
    staleTime: 60_000,
  })
  // T-015: the source of the browser's engine this installation serves (AGPL-3.0), next to it (review of #86).
  const sources = useBrowserEngine().data?.sources

  return (
    <div className="flex flex-col gap-6">
      <Section title="TCG Pocket">
        <KeyValue
          items={[
            { label: 'Interfaz', value: __APP_VERSION__ },
            { label: 'Servidor', value: health.data?.version ?? '…' },
            { label: 'Catálogo', value: <code className="font-mono">{shortSha(health.data?.catalogCommit)}</code> },
            { label: 'Motor', value: <code className="font-mono">{shortSha(health.data?.engineRev)}</code> },
          ]}
        />
        <p className="text-sm text-muted-foreground">App personal para un solo usuario. No es un servicio.</p>
      </Section>

      <Section title="Licencias">
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Los datos del catálogo (cartas, expansiones, sobres y el modelo de probabilidades) derivan de{' '}
            <a
              className="underline"
              href="https://github.com/marcelpanse/tcg-pocket-collection-tracker"
              target="_blank"
              rel="noreferrer"
            >
              marcelpanse/tcg-pocket-collection-tracker
            </a>{' '}
            (GPL-3.0, commit <code className="font-mono">3ab58f1</code>). No se copia código de su interfaz ni sus
            imágenes.
          </p>
          <p>
            El motor de simulación enlaza{' '}
            <a
              className="underline"
              href="https://github.com/santiqwerty1/deckgym-core"
              target="_blank"
              rel="noreferrer"
            >
              santiqwerty1/deckgym-core
            </a>
            , nuestra copia de{' '}
            <a className="underline" href="https://github.com/bcollazo/deckgym-core" target="_blank" rel="noreferrer">
              bcollazo/deckgym-core
            </a>{' '}
            (AGPL-3.0, commit <code className="font-mono">77e0617</code>), sobre el commit 7aa4ef0 de upstream, con C1
            «Dual Fusion», y con lo que upstream todavía no tiene: funciones para los bots y una evaluación más rápida,
            con las mismas partidas. Va compilado en los paquetes del worker y, para jugar en el navegador, en
            WebAssembly; sus fuentes, con la misma licencia, son las del{' '}
            <a className="underline" href="https://github.com/santiqwerty1/tcg-pocket" target="_blank" rel="noreferrer">
              repositorio
            </a>
            {sources ? (
              <>
                , y las del motor del navegador de esta instalación se bajan en{' '}
                <a className="underline" href={`${ENGINE_BASE}${sources}`} download>
                  {sources}
                </a>
              </>
            ) : null}
            .
          </p>
          <p>
            La interfaz usa componentes generados con shadcn/ui (MIT), Radix UI, TanStack Query, React Router y Tailwind
            CSS.
          </p>
          <p className="text-muted-foreground">
            El detalle de licencias y pins está en <code>docs/LICENCIAS.md</code> del repositorio.
          </p>
        </div>
      </Section>
    </div>
  )
}
