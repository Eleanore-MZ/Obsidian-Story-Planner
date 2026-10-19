import { App, Modal, Setting } from "obsidian";
import { Story, StoryDate } from "../model/types";
import { DateEditor } from "./DateEditor";

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

/** Offers a few options in a dropdown, for example where a deleted chapter's scenes should go. */
export class ChoiceModal extends Modal {
  private value: string;

  constructor(
    app: App,
    private choice: { title: string; message: string; options: { value: string; label: string }[]; confirm: string; onChoose: (value: string) => void },
  ) {
    super(app);
    this.value = choice.options[0]?.value ?? "";
  }

  onOpen(): void {
    this.titleEl.setText(this.choice.title);
    this.contentEl.createEl("p", { text: this.choice.message });
    new Setting(this.contentEl).addDropdown((d) => {
      for (const option of this.choice.options) d.addOption(option.value, option.label);
      d.setValue(this.value).onChange((v) => (this.value = v));
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(this.choice.confirm)
          .setWarning()
          .onClick(() => {
            this.close();
            this.choice.onChoose(this.value);
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Confirms a new date for a card moved to another span in story time. Dates
 * are facts in these stories, so a drag never changes one silently.
 */
export class DateModal extends Modal {
  constructor(
    app: App,
    private story: Story,
    private heading: string,
    private message: string,
    private initial: StoryDate,
    private onConfirm: (date: StoryDate) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    this.contentEl.addClass("story-planner-date-modal");
    this.contentEl.createEl("p", { text: this.message });
    const field = this.contentEl.createDiv({ cls: "story-planner-panel-field" });
    const editor = new DateEditor(field, this.story, this.initial, "modal", "Zone: default", () => {});
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        b.setButtonText("Change date")
          .setCta()
          .onClick(() => {
            if (!editor.valid) return;
            this.close();
            this.onConfirm(editor.valid);
          });
        const sync = () => b.setDisabled(!editor.valid);
        field.addEventListener("input", sync);
        field.addEventListener("change", sync);
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
