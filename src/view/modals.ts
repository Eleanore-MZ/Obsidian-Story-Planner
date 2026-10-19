import { App, Modal, Setting } from "obsidian";

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
