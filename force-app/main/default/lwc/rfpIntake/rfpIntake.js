import { LightningElement, api } from "lwc";
import { loadScript } from "lightning/platformResourceLoader";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { notifyRecordUpdateAvailable } from "lightning/uiRecordApi";
import PARSERS from "@salesforce/resourceUrl/rfpParsers";
import extract from "@salesforce/apex/RfpIntakeController.extract";
import applyValues from "@salesforce/apex/RfpIntakeController.applyValues";

const TEXT_EXTENSIONS = ["txt", "eml", "md", "csv", "tsv", "json", "html", "htm"];
const SHEET_EXTENSIONS = ["xlsx", "xls", "xlsm", "ods"];
const MAX_ATTACH_BYTES = 2.5 * 1024 * 1024;

const CONFIDENCE = {
    high: { label: "High confidence", badge: "badge badge_high", row: "row row_high" },
    medium: { label: "Check this", badge: "badge badge_medium", row: "row row_medium" },
    low: { label: "Low confidence", badge: "badge badge_low", row: "row row_low" },
    none: { label: "Not in RFP", badge: "badge badge_none", row: "row row_none" }
};

export default class RfpIntake extends LightningElement {
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
    currentAmount;
    updateAmount = true;
    attachFile = true;
    lastAppliedCount = 0;

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

    get foundCount() {
        return this.rows.filter((r) => r.confidence !== "none").length;
    }

    get selectedCount() {
        return this.rows.filter((r) => r.include).length;
    }

    get applyLabel() {
        const n = this.selectedCount;
        return n === 1 ? "Apply 1 field" : `Apply ${n} fields`;
    }

    get applyDisabled() {
        return this.selectedCount === 0;
    }

    get sourceLabel() {
        return this.fileName || "Pasted text";
    }

    get budgetRow() {
        return this.rows.find((r) => r.fieldApiName === "Gross_Budget__c");
    }

    get showAmountOption() {
        const row = this.budgetRow;
        return !!(row && row.include && row.value);
    }

    get amountOptionLabel() {
        const current = this.currentAmount ? this.formatCurrency(this.currentAmount) : "empty";
        return `Also set Opportunity Amount to the gross budget (currently ${current})`;
    }

    get canAttach() {
        return !!this.file && this.file.size <= MAX_ATTACH_BYTES;
    }

    get attachLabel() {
        return `Attach ${this.fileName} to this opportunity`;
    }

    get hasApplied() {
        return this.lastAppliedCount > 0;
    }

    get appliedMessage() {
        return `${this.lastAppliedCount} fields were saved from the last RFP. Drop another to update them.`;
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
        this.statusText = "Einstein is pulling out budget, flight dates, audience, and channels…";
        try {
            const result = await extract({ opportunityId: this.recordId, documentText: text });
            this.advertiserName = result.advertiserName;
            this.currentAmount = result.currentAmount;
            this.warnings = result.warnings || [];
            this.rows = (result.fields || []).map((f) => this.toRow(f));
            this.updateAmount = true;
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
            include: !!f.value && confidence !== "none",
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
            currentDisplay: this.formatCurrent(f),
            hasEvidence: !!f.evidence && confidence !== "none"
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
        this.rows = this.rows.map((r) => (r.fieldApiName === fieldApiName ? this.decorate({ ...r, ...changes }) : r));
    }

    handleIncludeChange(event) {
        this.updateRow(event.target.dataset.field, { include: event.target.checked });
    }

    handleValueChange(event) {
        const value = event.detail.value;
        this.updateRow(event.target.dataset.field, {
            value: value === "" || value === undefined ? null : String(value),
            include: value !== "" && value !== null && value !== undefined
        });
    }

    handleAgencyChange(event) {
        const recordId = event.detail.recordId;
        this.updateRow(event.target.dataset.field, { value: recordId || null, include: !!recordId });
    }

    handleChipClick(event) {
        const { field, value } = event.currentTarget.dataset;
        const row = this.rows.find((r) => r.fieldApiName === field);
        const selected = row.value ? row.value.split(";") : [];
        const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
        const ordered = row.options.map((o) => o.value).filter((v) => next.includes(v));
        this.updateRow(field, { value: ordered.length ? ordered.join(";") : null, include: ordered.length > 0 });
    }

    handleUpdateAmountChange(event) {
        this.updateAmount = event.target.checked;
    }

    handleAttachChange(event) {
        this.attachFile = event.target.checked;
    }

    handleStartOver() {
        this.reset();
    }

    async handleApply() {
        const fieldValues = {};
        this.rows
            .filter((r) => r.include)
            .forEach((r) => {
                fieldValues[r.fieldApiName] = r.value || "";
            });
        const count = Object.keys(fieldValues).length;

        this.stage = "reading";
        this.statusText = "Saving to the opportunity…";
        try {
            const attach = this.attachFile && this.canAttach;
            await applyValues({
                opportunityId: this.recordId,
                fieldValues,
                updateAmount: this.showAmountOption && this.updateAmount,
                fileName: attach ? this.fileName : null,
                fileBase64: attach ? await this.toBase64(this.file) : null
            });
            await notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: "RFP applied",
                    message: `${count} fields were saved to this opportunity.`,
                    variant: "success"
                })
            );
            this.reset();
            this.lastAppliedCount = count;
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

    formatCurrent(f) {
        const v = f.currentValue;
        if (v === null || v === undefined || v === "") {
            return "Currently empty";
        }
        let display = v;
        if (f.dataType === "currency") {
            display = this.formatCurrency(v);
        } else if (f.dataType === "number") {
            display = new Intl.NumberFormat("en-US").format(Number(v));
        } else if (f.dataType === "date") {
            display = new Date(v + "T00:00:00").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric"
            });
        } else if (f.dataType === "multipicklist") {
            display = v.split(";").join(", ");
        } else if (v.length > 80) {
            display = v.substring(0, 80) + "…";
        }
        return `Currently: ${display}`;
    }

    formatCurrency(value) {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2
        }).format(Number(value) || 0);
    }

    reduceError(error) {
        if (error && error.body && error.body.message) {
            return error.body.message;
        }
        if (error && error.message) {
            return error.message;
        }
        return "Something went wrong reading the RFP.";
    }
}
