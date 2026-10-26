// StepList.jsx — 01/02/03 hairline steps (§5.4).
export default function StepList() {
  const steps = [
    {
      num: "01",
      title: "Customer asks",
      quote: '"Anything free Saturday afternoon?"',
    },
    {
      num: "02",
      title: "Engine checks",
      quote: "Real staff, real hours, real bookings.",
    },
    {
      num: "03",
      title: "Spot is held",
      quote: "Confirmed in chat. Row written to the database.",
    },
  ];

  return (
    <div className="border-y border-ink/10 py-10 sm:py-16">
      <div className="max-w-[1120px] mx-auto px-6 sm:px-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {steps.map((step, i) => (
            <div
              key={step.num}
              className="flex gap-4 border-r border-ink/10 pr-8 last:border-0 last:pr-0"
            >
              <span className="shrink-0 font-mono text-[2.25rem] font-semibold text-ink/25 leading-none">
                {step.num}
              </span>
              <div>
                <p className="text-[0.9375rem] font-semibold text-ink">{step.title}</p>
                <p className="mt-1 text-base leading-1.6 text-ink/60">{step.quote}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
