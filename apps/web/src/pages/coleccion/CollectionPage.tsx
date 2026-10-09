import { ArrowLeftRightIcon, DownloadIcon, SlidersHorizontalIcon, TrophyIcon, UploadIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { exportCollectionCsv, useCollectionSummary } from '@/api/collection'
import { ErrorState } from '@/components/ListState'
import { Stat } from '@/components/Stat'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate, formatNumber } from '@/lib/format'
import { ByEditionTab } from './ByEditionTab'
import { ByGroupTab } from './ByGroupTab'
import { PackLuckSection } from './PackLuckSection'

type View = 'carta' | 'edicion'
const SUMMARY_SKELETONS = ['copies', 'units', 'one', 'two', 'missing', 'last']

export function CollectionPage() {
  const [params, setParams] = useSearchParams()
  const view: View = params.get('vista') === 'edicion' ? 'edicion' : 'carta'
  const summary = useCollectionSummary()
  const [exporting, setExporting] = useState(false)

  function setView(next: string) {
    const copy = new URLSearchParams(params)
    if (next === 'carta') copy.delete('vista')
    else copy.set('vista', next)
    setParams(copy, { replace: true })
  }

  async function exportCsv() {
    setExporting(true)
    try {
      const name = await exportCollectionCsv()
      toast.success(`Descargado ${name}`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/coleccion/importar">
            <UploadIcon data-icon="inline-start" />
            Importar
          </Link>
        </Button>
        <Button variant="outline" onClick={exportCsv} disabled={exporting}>
          <DownloadIcon data-icon="inline-start" />
          Exportar CSV
        </Button>
        <Button variant="outline" asChild>
          <Link to="/coleccion/ajustes">
            <SlidersHorizontalIcon data-icon="inline-start" />
            Ajustes
            {summary.data && summary.data.activeAdjustments > 0 ? (
              <Badge variant="secondary">{summary.data.activeAdjustments}</Badge>
            ) : null}
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/coleccion/misiones">
            <TrophyIcon data-icon="inline-start" />
            Misiones
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/coleccion/intercambio">
            <ArrowLeftRightIcon data-icon="inline-start" />
            Intercambio
          </Link>
        </Button>
      </div>

      {summary.isError ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : null}
      {summary.isPending ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SUMMARY_SKELETONS.map((id) => (
            <Skeleton key={id} className="h-20" />
          ))}
        </div>
      ) : null}
      {summary.data ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Copias jugables" value={formatNumber(summary.data.copies)} />
          <Stat label="Unidades con ≥1" value={formatNumber(summary.data.stockUnitsCollected)} />
          <Stat
            label="Cartas con ≥1"
            value={formatNumber(summary.data.groupsWithAtLeast.one)}
            hint="cartas funcionales"
          />
          <Stat
            label="Cartas con ≥2"
            value={formatNumber(summary.data.groupsWithAtLeast.two)}
            hint="listas para un mazo"
          />
          <Stat label="Faltantes" value={formatNumber(summary.data.groupsMissing)} hint="cartas funcionales con 0" />
          <Stat
            label="Último import"
            value={<span className="text-base">{formatDate(summary.data.lastImportAt)}</span>}
          />
        </div>
      ) : null}

      <Tabs value={view} onValueChange={setView}>
        <TabsList className="w-full">
          <TabsTrigger value="carta">Por carta</TabsTrigger>
          <TabsTrigger value="edicion">Por edición</TabsTrigger>
        </TabsList>
        <TabsContent value="carta">
          <ByGroupTab />
        </TabsContent>
        <TabsContent value="edicion">
          <ByEditionTab />
        </TabsContent>
      </Tabs>
      <PackLuckSection />
    </div>
  )
}
