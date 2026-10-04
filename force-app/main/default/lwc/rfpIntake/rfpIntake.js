import { LightningElement, api } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { loadScript } from "lightning/platformResourceLoader";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import PARSERS from "@salesforce/resourceUrl/rfpParsers";
import extract from "@salesforce/apex/RfpIntakeController.extract";
import createOpportunity from "@salesforce/apex/RfpIntakeController.createOpportunity";

const TEXT_EXTENSIONS = ["txt", "eml", "md", "csv", "tsv", "json", "html", "htm"];
const SHEET_EXTENSIONS = ["xlsx", "xls", "xlsm", "ods"];
const MAX_ATTACH_BYTES = 2.5 * 1024 * 1024;
const CORE_FIELDS = ["Name", "AccountId", "StageName", "CloseDate", "Amount"];

const CONFIDENCE = {
    high: { label: "High confidence", badge: "badge badge_high", row: "row row_high" },
    medium: { label: "Check this", badge: "badge badge_medium", row: "row row_medium" },
    low: { label: "Low confidence", badge: "badge badge_low", row: "row row_low" },
    default: { label: "Default", badge: "badge badge_default", row: "row row_default" },
    none: { label: "Not in RFP", badge: "badge badge_none", row: "row row_none" }
};

export default class RfpIntake extends NavigationMixin(LightningElement) {
    @api recordId;

    stage = "input";
    statusText = "";
    error;
    isDragging = false;
    showPaste = false;
    pastedText = "";

    file;
    fileName;
    rows = [];
    warnings = [];
    advertiserName;
    createAccount = false;
    attachFile = true;

    pdfReady;
    sheetReady;

    get isInput() {
        return this.stage === "input";
    }

    get isReading() {
        return this.stage === "reading";
    }

    get isReview() {
        return this.stage === "review";
    }

    get dropzoneClass() {
        return this.isDragging ? "dropzone dropzone_active" : "dropzone";
    }

    get pasteToggleLabel() {
        return this.showPaste ? "Hide paste box" : "Or paste RFP text";
    }

    get pasteDisabled() {
        return !this.pastedText || !this.pastedText.trim();
    }

    get hasWarnings() {
        return this.warnings.length > 0;
    }

    get coreRows() {
        return this.rows.filter((r) => CORE_FIELDS.includes(r.fieldApiName));
    }

    get detailRows() {
        return this.rows.filter((r) => !CORE_FIELDS.includes(r.fieldApiName));
    }

    get foundCount() {
        return this.detailRows.filter((r) => r.confidence !== "none").length;
    }

    get detailCount() {
        return this.detailRows.length;
    }

    get accountRow() {
        return this.rows.find((r) => r.fieldApiName === "AccountId");
    }

    get showCreateAccount() {
        const row = this.accountRow;
        return !!(row && !row.value && this.advertiserName);
    }

    get createAccountLabel() {
        return `Create a new account named "${this.advertiserName}"`;
    }

    get missingRequired() {
        return this.rows.some((r) => r.required && !r.value);
    }

    get missingAccount() {
        const row = this.accountRow;
        return !!row && !row.value && !(this.showCreateAccount && this.createAccount);
    }

    get createDisabled() {
        return this.missingRequired || this.missingAccount;
    }

    get createHint() {
        if (this.missingRequired) {
            return "Fill in the name, stage, and close date to continue.";
        }
        if (this.missingAccount) {
            return "Pick an account, or create one for the advertiser.";
        }
        return "";
    }

    get sourceLabel() {
        return this.fileName || "Pasted text";
    }

    get canAttach() {
        return !!this.file && this.file.size <= MAX_ATTACH_BYTES;
    }

    get attachLabel() {
        return `Attach ${this.fileName} to the new opportunity`;
    }

    handleDragOver(event) {
        event.preventDefault();
        this.isDragging = true;
    }

    handleDragLeave() {
        this.isDragging = false;
    }

    handleDrop(event) {
        event.preventDefault();
        this.isDragging = false;
        const files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length) {
            this.processFile(files[0]);
        }
    }

    handleBrowse() {
        this.template.querySelector("input.file-input").click();
    }

    handleFileChange(event) {
        const files = event.target.files;
        if (files && files.length) {
            this.processFile(files[0]);
        }
        event.target.value = null;
    }

    togglePaste() {
        this.showPaste = !this.showPaste;
    }

    handlePasteChange(event) {
        this.pastedText = event.detail.value;
    }

    handleReadPasted() {
        this.file = undefined;
        this.fileName = undefined;
        this.runExtraction(this.pastedText);
    }

    async processFile(file) {
        this.error = undefined;
        this.file = file;
        this.fileName = file.name;
        this.stage = "reading";
        this.statusText = `Reading ${file.name}…`;
        try {
            const text = await this.readFileText(file);
            await this.runExtraction(text);
        } catch (e) {
            this.fail(this.reduceError(e));
        }
    }

    async runExtraction(text) {
        this.error = undefined;
        if (!text || !text.trim()) {
            this.fail("No readable text was found. If this is a scanned PDF, paste the text instead.");
            return;
        }
        this.stage = "reading";
        this.statusText = "Einstein is pulling out the advertiser, budget, flight dates, audience, and channels…";
        try {
            const result = await extract({ contextRecordId: this.recordId, documentText: text });
            this.advertiserName = result.advertiserName;
            this.warnings = result.warnings || [];
            this.rows = (result.fields || []).map((f) => this.toRow(f));
            this.createAccount = this.showCreateAccount;
            this.attachFile = this.canAttach;
            this.stage = "review";
        } catch (e) {
            this.fail(this.reduceError(e));
        }
    }

    async readFileText(file) {
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        if (ext === "pdf") {
            return this.readPdf(file);
        }
        if (SHEET_EXTENSIONS.includes(ext)) {
            return this.readSheet(file);
        }
        if (TEXT_EXTENSIONS.includes(ext) || (file.type && file.type.startsWith("text/"))) {
            return file.text();
        }
        throw new Error(`.${ext} files aren't supported yet. Use PDF, Excel, CSV, or text, or paste the RFP text.`);
    }

    async readPdf(file) {
        if (!this.pdfReady) {
            this.pdfReady = loadScript(this, PARSERS + "/pdf.min.js").then(() =>
                loadScript(this, PARSERS + "/pdf.worker.min.js")
            );
        }
        await this.pdfReady;
        const pdfjsLib = window.pdfjsLib || window["pdfjs-dist/build/pdf"];
        pdfjsLib.GlobalWorkerOptions.workerSrc = PARSERS + "/pdf.worker.min.js";

        const data = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
        const pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
            this.statusText = `Reading page ${i} of ${doc.numPages}…`;
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join(""));
        }
        return pages.join("\n\n");
    }

    async readSheet(file) {
        if (!this.sheetReady) {
            this.sheetReady = loadScript(this, PARSERS + "/xlsx.full.min.js");
        }
        await this.sheetReady;
        const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        return workbook.SheetNames.map(
            (name) => `Sheet: ${name}\n` + window.XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false })
        ).join("\n\n");
    }

    toRow(f) {
        const confidence = CONFIDENCE[f.confidence] ? f.confidence : "medium";
        const row = {
            ...f,
            confidence,
            include: f.required || (!!f.value && confidence !== "none"),
            badgeLabel: CONFIDENCE[confidence].label,
            badgeClass: CONFIDENCE[confidence].badge,
            isDate: f.dataType === "date",
            isCurrency: f.dataType === "currency",
            isNumber: f.dataType === "number",
            isText: f.dataType === "text",
            isTextarea: f.dataType === "textarea",
            isPicklist: f.dataType === "picklist",
            isMulti: f.dataType === "multipicklist",
            isLookup: f.dataType === "lookup",
            hasEvidence: !!f.evidence && confidence !== "none" && confidence !== "default"
        };
        return this.decorate(row);
    }

    decorate(row) {
        const selected = row.isMulti && row.value ? row.value.split(";") : [];
        return {
            ...row,
            rowClass: CONFIDENCE[row.confidence].row + (row.include ? "" : " row_skipped"),
            chips: row.isMulti
                ? row.options.map((o) => ({
                      label: o.label,
                      value: o.value,
                      className: selected.includes(o.value) ? "chip chip_on" : "chip"
                  }))
                : []
        };
    }

    updateRow(fieldApiName, changes) {
        const before = this.rows.find((r) => r.fieldApiName === fieldApiName);
        const include = changes.include === undefined ? before.include : changes.include;
        this.rows = this.rows.map((r) => {
            if (r.fieldApiName === fieldApiName) {
                return this.decorate({ ...r, ...changes, include: r.required || include });
            }
            if (
                fieldApiName === "Gross_Budget__c" &&
                r.fieldApiName === "Amount" &&
                "value" in changes &&
                r.value === before.value
            ) {
                return this.decorate({ ...r, value: changes.value, include: !!changes.value });
            }
            return r;
        });
    }

    handleRowChange(event) {
        const { fieldApiName, ...changes } = event.detail;
        this.updateRow(fieldApiName, changes);
    }

    handleCreateAccountChange(event) {
        this.createAccount = event.target.checked;
    }

    handleAttachChange(event) {
        this.attachFile = event.target.checked;
    }

    handleStartOver() {
        this.reset();
    }

    async handleCreate() {
        const fieldValues = {};
        this.rows
            .filter((r) => r.include && r.value)
            .forEach((r) => {
                fieldValues[r.fieldApiName] = r.value;
            });

        this.stage = "reading";
        this.statusText = "Creating the opportunity…";
        try {
            const attach = this.attachFile && this.canAttach;
            const newId = await createOpportunity({
                fieldValues,
                newAccountName: this.showCreateAccount && this.createAccount ? this.advertiserName : null,
                fileName: attach ? this.fileName : null,
                fileBase64: attach ? await this.toBase64(this.file) : null
            });
            this.dispatchEvent(
                new ShowToastEvent({
                    title: "Opportunity created",
                    message: `"${fieldValues.Name}" was created from the RFP.`,
                    variant: "success"
                })
            );
            this.reset();
            this[NavigationMixin.Navigate]({
                type: "standard__recordPage",
                attributes: { recordId: newId, objectApiName: "Opportunity", actionName: "view" }
            });
        } catch (e) {
            this.stage = "review";
            this.error = this.reduceError(e);
        }
    }

    reset() {
        this.stage = "input";
        this.rows = [];
        this.warnings = [];
        this.file = undefined;
        this.fileName = undefined;
        this.advertiserName = undefined;
        this.pastedText = "";
        this.showPaste = false;
        this.error = undefined;
    }

    fail(message) {
        this.stage = "input";
        this.error = message;
    }

    toBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    reduceError(error) {
        if (error && error.body && error.body.message) {
            return error.body.message;
        }
        if (error && error.body && error.body.pageErrors && error.body.pageErrors.length) {
            return error.body.pageErrors[0].message;
        }
        if (error && error.message) {
            return error.message;
        }
        return "Something went wrong reading the RFP.";
    }
}
