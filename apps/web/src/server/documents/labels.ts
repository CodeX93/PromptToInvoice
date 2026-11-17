/**
 * Labels printed on invoice documents, per document language. The UI
 * language and the document language are independent: a German freelancer
 * may bill a US client in English.
 */
export const DOC_LANGUAGES = ["en", "de", "fr", "es", "nl", "it"] as const;
export type DocLanguage = (typeof DOC_LANGUAGES)[number];

export interface DocLabels {
  invoice: string;
  creditNote: string;
  draft: string;
  number: string;
  issueDate: string;
  dueDate: string;
  supplyDate: string;
  reference: string;
  billTo: string;
  from: string;
  description: string;
  quantity: string;
  unitPrice: string;
  tax: string;
  amount: string;
  subtotal: string;
  discount: string;
  totalExclTax: string;
  total: string;
  amountPaid: string;
  amountDue: string;
  vat: string;
  vatId: string;
  taxId: string;
  registration: string;
  paymentDetails: string;
  accountHolder: string;
  iban: string;
  bic: string;
  scanToPay: string;
  payOnline: string;
  notes: string;
  terms: string;
  correctsInvoice: string;
  page: string;
  paid: string;
  void: string;
  taxSummary: string;
  taxableAmount: string;
  dueOnReceipt: string;
  quote: string;
  validUntil: string;
}

const en: DocLabels = {
  invoice: "Invoice",
  creditNote: "Credit note",
  draft: "Draft",
  number: "Number",
  issueDate: "Issue date",
  dueDate: "Due date",
  supplyDate: "Date of supply",
  reference: "Reference",
  billTo: "Bill to",
  from: "From",
  description: "Description",
  quantity: "Qty",
  unitPrice: "Unit price",
  tax: "Tax",
  amount: "Amount",
  subtotal: "Subtotal",
  discount: "Discount",
  totalExclTax: "Total excl. tax",
  total: "Total",
  amountPaid: "Paid",
  amountDue: "Amount due",
  vat: "VAT",
  vatId: "VAT ID",
  taxId: "Tax ID",
  registration: "Registration",
  paymentDetails: "Payment details",
  accountHolder: "Account holder",
  iban: "IBAN",
  bic: "BIC",
  scanToPay: "Scan with your banking app",
  payOnline: "Pay online",
  notes: "Notes",
  terms: "Terms",
  correctsInvoice: "Corrects invoice",
  page: "Page",
  paid: "Paid",
  void: "Void",
  taxSummary: "Tax summary",
  taxableAmount: "Taxable amount",
  dueOnReceipt: "Due on receipt",
  quote: "Quote",
  validUntil: "Valid until",
};

const de: DocLabels = {
  invoice: "Rechnung",
  creditNote: "Gutschrift",
  draft: "Entwurf",
  number: "Nummer",
  issueDate: "Rechnungsdatum",
  dueDate: "Fällig am",
  supplyDate: "Leistungsdatum",
  reference: "Referenz",
  billTo: "Rechnung an",
  from: "Von",
  description: "Beschreibung",
  quantity: "Menge",
  unitPrice: "Einzelpreis",
  tax: "USt.",
  amount: "Betrag",
  subtotal: "Zwischensumme",
  discount: "Rabatt",
  totalExclTax: "Summe netto",
  total: "Gesamtbetrag",
  amountPaid: "Bezahlt",
  amountDue: "Offener Betrag",
  vat: "USt.",
  vatId: "USt-IdNr.",
  taxId: "Steuernummer",
  registration: "Handelsregister",
  paymentDetails: "Zahlungsinformationen",
  accountHolder: "Kontoinhaber",
  iban: "IBAN",
  bic: "BIC",
  scanToPay: "Mit der Banking-App scannen",
  payOnline: "Online bezahlen",
  notes: "Hinweise",
  terms: "Bedingungen",
  correctsInvoice: "Korrigiert Rechnung",
  page: "Seite",
  paid: "Bezahlt",
  void: "Storniert",
  taxSummary: "Steuerübersicht",
  taxableAmount: "Bemessungsgrundlage",
  dueOnReceipt: "Sofort fällig",
  quote: "Angebot",
  validUntil: "Gültig bis",
};

const fr: DocLabels = {
  ...en,
  invoice: "Facture",
  creditNote: "Avoir",
  draft: "Brouillon",
  number: "Numéro",
  issueDate: "Date d'émission",
  dueDate: "Échéance",
  supplyDate: "Date de prestation",
  reference: "Référence",
  billTo: "Facturé à",
  from: "De",
  description: "Désignation",
  quantity: "Qté",
  unitPrice: "Prix unitaire",
  tax: "TVA",
  amount: "Montant",
  subtotal: "Sous-total",
  discount: "Remise",
  totalExclTax: "Total HT",
  total: "Total TTC",
  amountPaid: "Payé",
  amountDue: "Reste à payer",
  vat: "TVA",
  vatId: "N° TVA",
  taxId: "SIRET",
  registration: "RCS",
  paymentDetails: "Coordonnées bancaires",
  accountHolder: "Titulaire",
  scanToPay: "Scannez avec votre application bancaire",
  payOnline: "Payer en ligne",
  notes: "Notes",
  terms: "Conditions",
  correctsInvoice: "Rectifie la facture",
  page: "Page",
  paid: "Payée",
  void: "Annulée",
  taxSummary: "Récapitulatif TVA",
  taxableAmount: "Base HT",
  dueOnReceipt: "À réception",
  quote: "Devis",
  validUntil: "Valable jusqu\u0027au",
};

const es: DocLabels = {
  ...en,
  invoice: "Factura",
  creditNote: "Factura rectificativa",
  draft: "Borrador",
  number: "Número",
  issueDate: "Fecha",
  dueDate: "Vencimiento",
  supplyDate: "Fecha de operación",
  reference: "Referencia",
  billTo: "Cliente",
  from: "Emisor",
  description: "Concepto",
  quantity: "Cant.",
  unitPrice: "Precio unit.",
  tax: "IVA",
  amount: "Importe",
  subtotal: "Subtotal",
  discount: "Descuento",
  totalExclTax: "Base imponible",
  total: "Total",
  amountPaid: "Pagado",
  amountDue: "Pendiente",
  vat: "IVA",
  vatId: "NIF-IVA",
  taxId: "NIF",
  registration: "Registro",
  paymentDetails: "Datos de pago",
  accountHolder: "Titular",
  scanToPay: "Escanee con su app bancaria",
  payOnline: "Pagar en línea",
  notes: "Notas",
  terms: "Condiciones",
  correctsInvoice: "Rectifica la factura",
  page: "Página",
  paid: "Pagada",
  void: "Anulada",
  taxSummary: "Resumen de IVA",
  taxableAmount: "Base",
  dueOnReceipt: "Al recibo",
  quote: "Presupuesto",
  validUntil: "Válido hasta",
};

const nl: DocLabels = {
  ...en,
  invoice: "Factuur",
  creditNote: "Creditnota",
  draft: "Concept",
  number: "Nummer",
  issueDate: "Factuurdatum",
  dueDate: "Vervaldatum",
  supplyDate: "Leverdatum",
  reference: "Referentie",
  billTo: "Factuur aan",
  from: "Van",
  description: "Omschrijving",
  quantity: "Aantal",
  unitPrice: "Prijs",
  tax: "Btw",
  amount: "Bedrag",
  subtotal: "Subtotaal",
  discount: "Korting",
  totalExclTax: "Totaal excl. btw",
  total: "Totaal",
  amountPaid: "Betaald",
  amountDue: "Te betalen",
  vat: "Btw",
  vatId: "Btw-id",
  taxId: "KvK",
  registration: "KvK",
  paymentDetails: "Betaalgegevens",
  accountHolder: "Rekeninghouder",
  scanToPay: "Scan met je bank-app",
  payOnline: "Online betalen",
  notes: "Opmerkingen",
  terms: "Voorwaarden",
  correctsInvoice: "Corrigeert factuur",
  page: "Pagina",
  paid: "Betaald",
  void: "Vervallen",
  taxSummary: "Btw-overzicht",
  taxableAmount: "Grondslag",
  dueOnReceipt: "Direct",
  quote: "Offerte",
  validUntil: "Geldig tot",
};

const it: DocLabels = {
  ...en,
  invoice: "Fattura",
  creditNote: "Nota di credito",
  draft: "Bozza",
  number: "Numero",
  issueDate: "Data",
  dueDate: "Scadenza",
  supplyDate: "Data operazione",
  reference: "Riferimento",
  billTo: "Destinatario",
  from: "Mittente",
  description: "Descrizione",
  quantity: "Qtà",
  unitPrice: "Prezzo unit.",
  tax: "IVA",
  amount: "Importo",
  subtotal: "Subtotale",
  discount: "Sconto",
  totalExclTax: "Imponibile",
  total: "Totale",
  amountPaid: "Pagato",
  amountDue: "Da pagare",
  vat: "IVA",
  vatId: "P. IVA",
  taxId: "Cod. fiscale",
  registration: "REA",
  paymentDetails: "Pagamento",
  accountHolder: "Intestatario",
  scanToPay: "Scansiona con la tua app bancaria",
  payOnline: "Paga online",
  notes: "Note",
  terms: "Condizioni",
  correctsInvoice: "Rettifica fattura",
  page: "Pagina",
  paid: "Pagata",
  void: "Annullata",
  taxSummary: "Riepilogo IVA",
  taxableAmount: "Imponibile",
  dueOnReceipt: "A vista",
  quote: "Preventivo",
  validUntil: "Valido fino al",
};

const ALL: Record<DocLanguage, DocLabels> = { en, de, fr, es, nl, it };
const LOCALE: Record<DocLanguage, string> = {
  en: "en-GB",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  nl: "nl-NL",
  it: "it-IT",
};

export function docLanguage(v: string | null | undefined): DocLanguage {
  return (DOC_LANGUAGES as readonly string[]).includes(v ?? "") ? (v as DocLanguage) : "en";
}
export function labelsFor(lang: string | null | undefined): DocLabels {
  return ALL[docLanguage(lang)];
}
export function localeFor(lang: string | null | undefined, sellerCountry?: string): string {
  const l = docLanguage(lang);
  if (l === "en") return sellerCountry === "US" ? "en-US" : "en-GB";
  return LOCALE[l];
}
