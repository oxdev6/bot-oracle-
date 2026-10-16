/**
 * Tiny dependency-free Prometheus metrics registry.
 *
 * Only the two primitives an oracle node actually needs are supported:
 * monotonically increasing counters and settable gauges, each optionally
 * labelled. The output is the Prometheus text exposition format, so the node
 * can be scraped without shipping a metrics client library.
 */

export type MetricLabels = Record<string, string | number>;

interface Sample {
  labels: string;
  value: number;
}

interface Metric {
  name: string;
  help: string;
  type: "counter" | "gauge";
  samples: Map<string, Sample>;
}

function labelString(labels: MetricLabels = {}): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const body = keys.map((k) => `${sanitizeLabelName(k)}="${escapeLabel(String(labels[k]))}"`).join(",");
  return `{${body}}`;
}

function sanitizeLabelName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export class Metrics {
  private metrics = new Map<string, Metric>();

  private get(name: string, type: Metric["type"], help: string): Metric {
    let metric = this.metrics.get(name);
    if (!metric) {
      metric = { name, help, type, samples: new Map() };
      this.metrics.set(name, metric);
    }
    return metric;
  }

  counter(name: string, help: string, labels: MetricLabels = {}, amount = 1): void {
    const metric = this.get(name, "counter", help);
    const key = labelString(labels);
    const sample = metric.samples.get(key) ?? { labels: key, value: 0 };
    sample.value += amount;
    metric.samples.set(key, sample);
  }

  gauge(name: string, help: string, labels: MetricLabels = {}, value: number): void {
    const metric = this.get(name, "gauge", help);
    const key = labelString(labels);
    metric.samples.set(key, { labels: key, value });
  }

  /** Snapshot of a single sample value (used by tests). */
  value(name: string, labels: MetricLabels = {}): number | undefined {
    return this.metrics.get(name)?.samples.get(labelString(labels))?.value;
  }

  render(): string {
    const lines: string[] = [];
    for (const metric of [...this.metrics.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      for (const sample of metric.samples.values()) {
        lines.push(`${metric.name}${sample.labels} ${sample.value}`);
      }
    }
    return lines.join("\n") + "\n";
  }
}
