import { App, Modal, Setting } from "obsidian";
import { Card, CardStatus } from "../model/types";

/** Asks for a single line of text, such as a story or chapter name. */
export class TextPromptModal extends Modal {
  private value: string;

  constructor(
    app: App,
    private heading: string,
    initial: string,
    private onSubmit: (value: string) => void,
  ) {
    super(app);
    this.value = initial;
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    new Setting(this.contentEl).addText((t) => {
      t.setValue(this.value).onChange((v) => (this.value = v));
      t.inputEl.addClass("story-planner-wide-input");
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        }
      });
      window.setTimeout(() => t.inputEl.select(), 0);
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("OK").setCta().onClick(() => this.submit()));
  }

  private submit(): void {
    const value = this.value.trim();
    if (!value) return;
    this.close();
    this.onSubmit(value);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

const STATUS_LABELS: Record<CardStatus, string> = {
  idea: "Idea",
  outlined: "Outlined",
  drafted: "Drafted",
  revised: "Revised",
};

export type CardEdit = Pick<Card, "title" | "synopsis" | "status">;

/** Edits a card's basic fields. The side panel editor replaces this in phase one. */
export class CardEditModal extends Modal {
  private edit: CardEdit;

  constructor(
    app: App,
    card: CardEdit,
    private onSave: (edit: CardEdit) => void,
    private onDelete?: () => void,
  ) {
    super(app);
    this.edit = { title: card.title, synopsis: card.synopsis, status: card.status };
  }

  onOpen(): void {
    this.titleEl.setText(this.onDelete ? "Edit card" : "New card");
    const { contentEl } = this;

    new Setting(contentEl).setName("Title").addText((t) => {
      t.setValue(this.edit.title).onChange((v) => (this.edit.title = v));
      t.inputEl.addClass("story-planner-wide-input");
    });

    new Setting(contentEl).setName("Synopsis").addTextArea((t) => {
      t.setValue(this.edit.synopsis).onChange((v) => (this.edit.synopsis = v));
      t.inputEl.rows = 6;
      t.inputEl.addClass("story-planner-wide-input");
    });

    new Setting(contentEl).setName("Status").addDropdown((d) =>
      d
        .addOptions(STATUS_LABELS)
        .setValue(this.edit.status)
        .onChange((v) => (this.edit.status = v as CardStatus)),
    );

    const buttons = new Setting(contentEl);
    if (this.onDelete) {
      const onDelete = this.onDelete;
      buttons.addButton((b) =>
        b
          .setButtonText("Delete")
          .setWarning()
          .onClick(() => {
            this.close();
            onDelete();
          }),
      );
    }
    buttons.addButton((b) =>
      b
        .setButtonText("Save")
        .setCta()
        .onClick(() => {
          if (!this.edit.title.trim()) return;
          this.close();
          this.onSave({ ...this.edit, title: this.edit.title.trim() });
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
