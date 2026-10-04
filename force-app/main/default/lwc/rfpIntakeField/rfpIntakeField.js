import { LightningElement, api } from "lwc";

export default class RfpIntakeField extends LightningElement {
    @api row;

    get includeDisabled() {
        return this.row.required;
    }

    handleIncludeChange(event) {
        this.notify({ include: event.target.checked });
    }

    handleValueChange(event) {
        const value = event.detail.value;
        const empty = value === "" || value === null || value === undefined;
        this.notify({ value: empty ? null : String(value), include: !empty });
    }

    handleLookupChange(event) {
        const recordId = event.detail.recordId;
        this.notify({ value: recordId || null, include: !!recordId });
    }

    handleChipClick(event) {
        const value = event.currentTarget.dataset.value;
        const selected = this.row.value ? this.row.value.split(";") : [];
        const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
        const ordered = this.row.options.map((o) => o.value).filter((v) => next.includes(v));
        this.notify({ value: ordered.length ? ordered.join(";") : null, include: ordered.length > 0 });
    }

    notify(changes) {
        this.dispatchEvent(
            new CustomEvent("rowchange", { detail: { fieldApiName: this.row.fieldApiName, ...changes } })
        );
    }
}
