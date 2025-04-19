import { AfterViewInit, Component, DestroyRef, OnDestroy, OnInit } from '@angular/core';
import {
  HeartbeatRecord,
  PulsoidService,
} from '../../../../../../../services/integrations/pulsoid.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { Chart, TooltipModel } from 'chart.js/auto';
import 'chartjs-adapter-moment';

@Component({
  selector: 'app-heart-rate-chart',
  templateUrl: './heart-rate-chart.component.html',
  styleUrls: ['./heart-rate-chart.component.scss'],
  standalone: false,
})
export class HeartRateChartComponent implements OnInit, AfterViewInit, OnDestroy {
  private chartData: {
    x: string;
    y: [number, number];
    timestamp: number;
  }[] = [];
  private chart?: Chart;

  get hasEnoughData() {
    const minTimestamp = Math.min(...this.chartData.map((data) => data.timestamp)) ?? 0;
    const maxTimestamp = Math.max(...this.chartData.map((data) => data.timestamp)) ?? 0;
    const diff = maxTimestamp - minTimestamp;
    return diff >= 1000 * 60 * 5; // 5 minutes worth of data required
  }

  constructor(private destroyRef: DestroyRef, private pulsoid: PulsoidService) {}

  ngOnInit(): void {
    this.pulsoid.heartbeatRecords
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((records) => !!records.length)
        // throttleTime(1000 * 60, asyncScheduler, { leading: true, trailing: true })
      )
      .subscribe((data) => {
        this.processData(data, 24);
      });
  }

  ngAfterViewInit(): void {
    Chart.register(roundedFloatingBarsPlugin);
    this.chart = new Chart(document.getElementById('chart-canvas') as HTMLCanvasElement, {
      type: 'bar',
      options: {
        // animation: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: false,
            position: 'nearest',
            external: this.externalTooltipHandler.bind(this),
          },
        },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'minute',
              displayFormats: {
                minute: 'HH:mm',
                hour: 'HH:mm',
              },
            },
            ticks: {
              source: 'auto',
              color: 'white',
              maxRotation: 0,
            },
            grid: {
              color: 'transparent',
            },
            border: {
              color: 'transparent',
            },
            offset: true,
          },
          y: {
            suggestedMin: 40,
            suggestedMax: 100,
            beginAtZero: false,
            ticks: {
              color: 'white',
              precision: 0,
            },
            grid: {
              color: '#fff6',
            },
            border: {
              display: false,
            },
          },
        },
      },
      data: {
        datasets: [
          {
            label: 'Heart rate',
            data: this.chartData as any,
            backgroundColor: '#3aa8b5',
            borderRadius: 999999,
          },
        ],
      },
      plugins: [
        {
          id: 'customYRange',
          beforeUpdate: (chart) => {
            const yDatasets = chart.data.datasets.map((dataset) => dataset.data as number[]);
            const allYValues = yDatasets.flat();
            const maxYValue = Math.max(...allYValues);

            const yScale = chart.scales['y'];
            if (yScale) {
              yScale.options.suggestedMin = Math.min(Math.min(...allYValues), 40);
              yScale.options.suggestedMax = Math.max(maxYValue, 100);
            }
          },
        },
      ],
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private processData(data: HeartbeatRecord[], bucketCount: number) {
    if (!data.length) return;
    // Initialize variables for bucketing and results
    const minMaxBuckets: {
      [timestamp: number]: [number, number];
    } = {}; // {startingTimestamp: [minHeartRate, maxHeartRate]}
    const minTime = data[0][0];
    const maxTime = data[data.length - 1][0];
    const bucketSize = Math.ceil((maxTime - minTime) / bucketCount);
    // Group records by bucket
    const groupedRecords = data.reduce((acc, record) => {
      const bucketStart = Math.floor((record[0] - minTime) / bucketSize) * bucketSize + minTime;
      acc[bucketStart] ??= [];
      acc[bucketStart].push(record[1]);
      return acc;
    }, {} as { [timestamp: number]: number[] });
    // Calculate min and max for each bucket
    Object.entries(groupedRecords).forEach(([timestamp, heartRates]) => {
      if (Number(timestamp) > 0 && heartRates.length)
        minMaxBuckets[Number(timestamp)] = [
          Math.min(...heartRates) ?? 0,
          Math.max(...heartRates) ?? 0,
        ];
    });

    // Transform the bucket data into chart-compatible format
    this.chartData = Object.entries(minMaxBuckets).map(([timestamp, [min, max]]) => ({
      x: this.unixToFormattedDate(Number(timestamp)),
      y: [min, max],
      timestamp: Number(timestamp),
    }));

    // Update the chart with the new data
    this.updateChart();
  }

  private updateChart() {
    if (this.chart) {
      this.chart!.data.datasets[0].data = this.chartData as any;
      this.chart?.update();
    }
  }

  /**
   * Converts a Unix timestamp in milliseconds to a formatted date-time string.
   * @param {number} unixTimestamp - The Unix timestamp in milliseconds.
   * @returns {string} - Formatted date-time string 'YYYY-MM-DD HH:MM:SS'.
   */
  private unixToFormattedDate(unixTimestamp: number): string {
    // Create a new Date object using the Unix timestamp
    const date = new Date(unixTimestamp);

    // Extract date components
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    // Assemble the formatted date-time string
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  private getOrCreateTooltip(chart: Chart<'bar'>): HTMLDivElement {
    let tooltipEl = chart.canvas.parentNode?.querySelector('div') as HTMLDivElement;

    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.style.background = 'rgba(0, 0, 0, 0.7)';
      tooltipEl.style.borderRadius = '3px';
      tooltipEl.style.color = 'white';
      tooltipEl.style.opacity = '1';
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.position = 'absolute';
      tooltipEl.style.transform = 'translate(-50%, 0)';
      tooltipEl.style.transition = 'all .1s ease';

      const table = document.createElement('table');
      table.style.margin = '0px';

      tooltipEl.appendChild(table);
      chart.canvas.parentNode?.appendChild(tooltipEl);
    }

    return tooltipEl;
  }

  private externalTooltipHandler(context: { chart: Chart<'bar'>; tooltip: TooltipModel<'bar'> }) {
    // Tooltip and Chart Elements
    const { chart, tooltip } = context;

    // Get or create the tooltip element
    const tooltipEl = this.getOrCreateTooltip(chart);

    // Hide if no tooltip
    if (tooltip.opacity === 0) {
      tooltipEl.style.opacity = '0';
      return;
    }

    // Retrieve custom data for tooltip
    const dataPoints = tooltip.dataPoints || [];
    const linesOfText = dataPoints.map((point: any) => {
      const minMax = point.raw.y as [number, number]; // Replace with your actual data structure
      return `${minMax[0]} BPM - ${minMax[1]} BPM`;
    });

    // Create table body based on custom data
    const tableBody = document.createElement('tbody');
    linesOfText.forEach((line) => {
      const tr = document.createElement('tr');
      tr.style.borderWidth = '0';

      const td = document.createElement('td');
      td.style.borderWidth = '0';

      const text = document.createTextNode(line);
      td.appendChild(text);
      tr.appendChild(td);
      tableBody.appendChild(tr);
    });

    // Update table in tooltip element
    const tableRoot = tooltipEl.querySelector('table') as HTMLTableElement;
    while (tableRoot.firstChild) {
      tableRoot.firstChild.remove();
    }
    tableRoot.appendChild(tableBody);

    // Update position and styles
    const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;
    tooltipEl.style.opacity = '1';
    tooltipEl.style.left = `${positionX + tooltip.caretX}px`;
    tooltipEl.style.top = `${positionY + tooltip.caretY}px`;
    tooltipEl.style.padding = `${tooltip.options.padding}px ${tooltip.options.padding}px`;
  }
}

const roundedFloatingBarsPlugin = {
  id: 'roundedFloatingBars',
  beforeDatasetDraw: (chart: any, args: any) => args.index !== 0,
  afterDatasetsDraw: (chart: Chart) => {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((dataset: any, datasetIndex: any) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      meta.data.forEach((bar) => {
        const props = bar.getProps(['x', 'y', 'base']);
        const { x } = props;
        let { y, base } = props;
        const [min, max] = (bar as any).$context.raw.y;
        if (min == max) {
          y -= 4;
          base += 4;
        }
        const width = (bar as any).width;

        ctx.save();
        ctx.fillStyle = dataset.backgroundColor;

        const radius = 4;
        ctx.beginPath();
        ctx.moveTo(x - width / 2, y + radius);
        ctx.lineTo(x - width / 2, base - radius);
        ctx.quadraticCurveTo(x - width / 2, base, x - width / 2 + radius, base);
        ctx.lineTo(x + width / 2 - radius, base);
        ctx.quadraticCurveTo(x + width / 2, base, x + width / 2, base - radius);
        ctx.lineTo(x + width / 2, y + radius);
        ctx.quadraticCurveTo(x + width / 2, y, x + width / 2 - radius, y);
        ctx.lineTo(x - width / 2 + radius, y);
        ctx.quadraticCurveTo(x - width / 2, y, x - width / 2, y + radius);
        ctx.closePath();

        ctx.fill();
        ctx.restore();
      });
    });
  },
};
