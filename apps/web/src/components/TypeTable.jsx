// TypeTable.jsx — business-type table (§5.6).
export default function TypeTable() {
  const rows = [
    { type: "Salon", slot: "staff × service × time", status: "Demo" },
    { type: "B&amp;B / stay", slot: "unit × date range", status: "Next" },
    { type: "Restaurant", slot: "table × party × time", status: "Next" },
  ];

  return (
    <div className="border border-ink/10 rounded-[14px] overflow-hidden bg-white/60">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-ink/10 bg-ink/5">
            <th className="px-6 py-4 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
              Business
            </th>
            <th className="px-6 py-4 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
              A slot is
            </th>
            <th className="px-6 py-4 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-ink/40">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {rows.map((row) => (
            <tr key={row.type} className="last:border-b-0">
              <td className="px-6 py-4 font-medium text-ink">{row.type}</td>
              <td className="px-6 py-4 font-mono tabular-nums text-[0.875rem] text-ink/60">
                {row.slot}
              </td>
              <td className="px-6 py-4">
                <Pill tone={row.status === "Demo" ? "next" : "later"}>
                  {row.status}
                </Pill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 px-6 text-[0.75rem] leading-1.6 text-ink/40">
        A business type is a config preset, not a separate product. Only the
        meaning of "a slot" changes.
      </p>
    </div>
  );
}
