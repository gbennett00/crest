import { YnabImportWizard } from "@/components/import/ynab-import-wizard";

export default function ImportPage() {
  return (
    <div className="max-w-2xl p-4 space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Import from YNAB</h1>
      <YnabImportWizard />
    </div>
  );
}
