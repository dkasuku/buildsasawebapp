// Top-of-page section switcher (e.g. Observations / Corrective actions). Built
// on the shared header band and tab strip so every page's tabs look the same.
import { PageHeader, Tabs } from "./PageShell";

export function SectionTabs<T extends string>({ tabs, value, onChange, title, subtitle }: {
  tabs: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
  title?: string;
  subtitle?: string;
}) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      tabs={<Tabs<T> label={title ? `${title} sections` : "Sections"} value={value} onChange={onChange} items={tabs.map((t) => ({ id: t.key, label: t.label, count: t.count }))} />}
    />
  );
}
