import { LightningElement, api } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent";

export default class CursorNumberCard extends LightningElement {
    @api recordId;

    handleSuccess() {
        this.dispatchEvent(
            new ShowToastEvent({
                title: "Saved",
                message: "Cursor Number was updated.",
                variant: "success"
            })
        );
    }
}
