import { App, Modal, Setting } from "obsidian";
import { EXPORT_EXTENSIONS, ExportFormat, ExportOrder } from "../format/export";
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
    private choice: {
      title: string;
      message: string;
      options: { value: string; label: string }[];
      confirm: string;
      onChoose: (value: string) => void;
      /** True when confirming is an ordinary step rather than a destructive one. */
      safe?: boolean;
    },
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
        (this.choice.safe ? b.setCta() : b.setWarning())
          .setButtonText(this.choice.confirm)
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

/**
 * Chooses which characters the character track shows as lanes, and in what
 * order. A story may have many named characters and only a few worth tracking.
 */
export class LaneModal extends Modal {
  private chosen: string[];

  constructor(
    app: App,
    private story: Story,
    chosen: string[],
    private onDone: (chosen: string[]) => void,
  ) {
    super(app);
    this.chosen = [...chosen];
  }

  onOpen(): void {
    this.titleEl.setText("Characters to track");
    this.draw();
  }

  private draw(): void {
    const el = this.contentEl;
    el.empty();
    el.createEl("p", { cls: "setting-item-description", text: "Ticked characters get a lane, in this order. Drag lane headers to reorder them too." });
    const others = this.story.characters.filter((c) => !this.chosen.includes(c.id));
    const ordered = [...this.chosen.map((id) => this.story.characters.find((c) => c.id === id)!).filter(Boolean), ...others];
    for (const character of ordered) {
      const index = this.chosen.indexOf(character.id);
      const setting = new Setting(el).setName(character.name);
      setting.nameEl.addClass("story-planner-lane-choice");
      setting.nameEl.style.setProperty("--lane-color", character.color);
      if (index >= 0) {
        setting.addExtraButton((b) =>
          b
            .setIcon("arrow-up")
            .setTooltip("Earlier")
            .setDisabled(index === 0)
            .onClick(() => this.shift(index, -1)),
        );
        setting.addExtraButton((b) =>
          b
            .setIcon("arrow-down")
            .setTooltip("Later")
            .setDisabled(index === this.chosen.length - 1)
            .onClick(() => this.shift(index, 1)),
        );
      }
      setting.addToggle((t) =>
        t.setValue(index >= 0).onChange((on) => {
          this.chosen = on ? [...this.chosen, character.id] : this.chosen.filter((id) => id !== character.id);
          this.draw();
        }),
      );
    }
    new Setting(el)
      .addButton((b) =>
        b.setButtonText("All").onClick(() => {
          this.chosen = [...this.chosen, ...others.map((c) => c.id)];
          this.draw();
        }),
      )
      .addButton((b) =>
        b.setButtonText("None").onClick(() => {
          this.chosen = [];
          this.draw();
        }),
      )
      .addButton((b) =>
        b
          .setButtonText("Done")
          .setCta()
          .onClick(() => {
            this.close();
            this.onDone(this.chosen);
          }),
      );
  }

  private shift(index: number, by: number): void {
    const [id] = this.chosen.splice(index, 1);
    this.chosen.splice(index + by, 0, id!);
    this.draw();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface ExportChoice {
  format: ExportFormat;
  order: ExportOrder;
  /** Vault path of the new file. */
  path: string;
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  markdown: "Markdown outline (a readable note)",
  csv: "CSV (one row per card, for spreadsheets)",
  json: "JSON (all of the story's data)",
};

/** Asks how to export a story and where the new file goes. */
export class ExportModal extends Modal {
  private choice: ExportChoice;

  constructor(
    app: App,
    /** The file path without its extension, such as "Stories/The Glass Harbour export". */
    private base: string,
    private onExport: (choice: ExportChoice) => void,
  ) {
    super(app);
    this.choice = { format: "markdown", order: "reading", path: `${base}.md` };
  }

  onOpen(): void {
    this.titleEl.setText("Export story");
    this.contentEl.createEl("p", {
      text: "The export is written to a new file. The story note is not changed, and an existing file is never overwritten.",
    });
    let pathInput: HTMLInputElement | null = null;
    let orderSetting: Setting | null = null;
    new Setting(this.contentEl).setName("Format").addDropdown((d) => {
      for (const [value, label] of Object.entries(FORMAT_LABELS)) d.addOption(value, label);
      d.setValue(this.choice.format).onChange((value) => {
        this.choice.format = value as ExportFormat;
        // Follow the format with the extension, keeping a name the writer typed.
        const ext = EXPORT_EXTENSIONS[this.choice.format];
        this.choice.path = this.choice.path.replace(/\.(md|csv|json)$/i, "") + `.${ext}`;
        if (pathInput) pathInput.value = this.choice.path;
        orderSetting?.settingEl.toggle(this.choice.format !== "json");
      });
    });
    orderSetting = new Setting(this.contentEl).setName("Order").addDropdown((d) =>
      d
        .addOption("reading", "Reading order (chapters and scenes)")
        .addOption("time", "Story time (the order things happen)")
        .setValue(this.choice.order)
        .onChange((value) => (this.choice.order = value as ExportOrder)),
    );
    new Setting(this.contentEl).setName("File").setDesc("A path in the vault. A number is added if the file already exists.").addText((t) => {
      pathInput = t.inputEl;
      t.inputEl.addClass("story-planner-wide-input");
      t.setValue(this.choice.path).onChange((value) => (this.choice.path = value.trim()));
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Export")
          .setCta()
          .onClick(() => {
            if (!this.choice.path) return;
            this.close();
            this.onExport({ ...this.choice });
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
