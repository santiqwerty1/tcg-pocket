import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

/** Effect cleanup handles React 19 StrictMode, resize and route changes. */
export function AnalysisChart({
  title,
  x,
  values,
  lower,
  upper,
  histogram = false,
}: {
  title: string
  x: number[]
  values: number[]
  lower?: number[]
  upper?: number[]
  histogram?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = host.current
    if (!element || !x.length) return
    const data: uPlot.AlignedData = lower && upper ? [x, values, lower, upper] : [x, values]
    const color = getComputedStyle(element).color
    const plot = new uPlot(
      {
        width: Math.max(240, element.clientWidth),
        height: 230,
        scales: { x: { time: false }, y: histogram ? {} : { range: [0, 100] } },
        axes: [
          { stroke: color, label: histogram ? 'Turnos globales' : 'Posición en el ranking', grid: { show: false } },
          { stroke: color, label: histogram ? 'Partidas' : 'Victorias (n e IC abajo)' },
        ],
        series: [
          {},
          {
            label: histogram ? 'Partidas' : 'Victorias',
            stroke: '#0284c7',
            width: 2,
            ...(histogram
              ? { paths: uPlot.paths.bars?.({ size: [0.8, 30] }), fill: '#0284c7' }
              : { paths: () => null, points: { show: true, size: 7 } }),
          },
          ...(lower && upper
            ? [
                { label: 'IC inferior', stroke: '#64748b', width: 1 },
                { label: 'IC superior', stroke: '#64748b', width: 1 },
              ]
            : []),
        ],
        bands: lower && upper ? [{ series: [3, 2], fill: 'rgba(2,132,199,0.15)' }] : [],
        legend: { show: false },
        cursor: { drag: { x: false, y: false } },
        select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      },
      data,
      element,
    )
    const resize = new ResizeObserver(() => plot.setSize({ width: Math.max(240, element.clientWidth), height: 230 }))
    resize.observe(element)
    return () => {
      resize.disconnect()
      plot.destroy()
    }
  }, [x, values, lower, upper, histogram])
  return <div ref={host} role="img" aria-label={title} className="w-full min-w-0 text-muted-foreground" />
}
