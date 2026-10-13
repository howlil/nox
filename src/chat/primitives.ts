import { setIcon, type IconName } from "obsidian";

export type NoxIconButtonOptions = {
  cls: string;
  icon: IconName;
  label: string;
  title?: string;
};

export type NoxButtonVariant = "primary" | "secondary" | "quiet" | "accent";

export type NoxButtonOptions = {
  cls?: string;
  label?: string;
  text?: string;
  title?: string;
  variant?: NoxButtonVariant;
  icon?: IconName;
};

export type NoxChipOptions = {
  cls?: string;
  text: string;
  variant?: "context" | "intent" | "attachment";
  icon?: IconName;
  iconClass?: string;
  labelClass?: string;
  removeLabel?: string;
  removeClass?: string;
  onRemove?: () => void;
};

export type NoxStatusOptions = {
  cls?: string;
  text: string;
  kind: "neutral" | "success" | "warning" | "error";
  action?: {
    label: string;
    cls?: string;
    onClick: () => void;
  };
};

export type NoxMenuRowOptions = {
  cls?: string;
  id?: string;
  icon?: IconName;
  iconClass?: string;
  nameClass?: string;
  descriptionClass?: string;
  commandClass?: string;
  selected?: boolean;
  trailingClass?: string;
  trailingIcon?: IconName;
  name: string;
  description?: string;
  command?: string;
  disabled?: boolean;
};

export type NoxMessageMetaOptions = {
  label: string;
  sub: string;
  time?: string;
};

export function setNoxIcon(element: HTMLElement, icon: IconName): void {
  element.empty();
  setIcon(element, icon);

  const svg = element.querySelector<SVGElement>("svg");
  if (!svg) return;

  svg.classList.add("nox-icon");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.style.setProperty("width", "15px", "important");
  svg.style.setProperty("height", "15px", "important");
  svg.style.setProperty("min-width", "15px", "important");
  svg.style.setProperty("min-height", "15px", "important");
  svg.style.setProperty("display", "block", "important");
}

export function createNoxIconButton(
  parent: HTMLElement,
  options: NoxIconButtonOptions,
): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: options.cls,
    attr: {
      type: "button",
      "aria-label": options.label,
    },
  });

  setNoxIcon(button, options.icon);
  if (options.title) button.title = options.title;
  return button;
}

export function createNoxButton(
  parent: HTMLElement,
  options: NoxButtonOptions,
): HTMLButtonElement {
  const variant = options.variant ?? "secondary";
  const button = parent.createEl("button", {
    cls: `nox-button nox-button--${variant}${options.cls ? ` ${options.cls}` : ""}`,
    attr: {
      type: "button",
      ...(options.label ? { "aria-label": options.label } : {}),
    },
    text: options.text,
  });

  if (options.icon) {
    const icon = button.createSpan({ cls: "nox-button-icon" });
    setNoxIcon(icon, options.icon);
  }

  if (options.title) button.title = options.title;
  return button;
}

export function createNoxChip(
  parent: HTMLElement,
  options: NoxChipOptions,
): HTMLElement {
  const variant = options.variant ?? "context";
  const chip = parent.createSpan({
    cls: `nox-chip nox-chip--${variant}${options.cls ? ` ${options.cls}` : ""}`,
  });

  if (options.icon) {
    const icon = chip.createSpan({ cls: options.iconClass ?? "nox-chip-icon" });
    setNoxIcon(icon, options.icon);
  } else if (variant === "context") {
    chip.createSpan({ cls: "nox-chip-dot" });
  }

  chip.createSpan({
    cls: options.labelClass ?? "nox-chip-label",
    text: options.text,
  });

  if (options.onRemove && options.removeLabel) {
    const remove = chip.createEl("button", {
      cls: `nox-chip-remove${options.removeClass ? ` ${options.removeClass}` : ""}`,
      attr: {
        type: "button",
        "aria-label": options.removeLabel,
      },
    });
    setNoxIcon(remove, "x");
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onRemove?.();
    });
  }

  return chip;
}

export function createNoxStatus(
  parent: HTMLElement,
  options: NoxStatusOptions,
): HTMLElement {
  const status = parent.createDiv({
    cls: `nox-status nox-status--${options.kind}${options.cls ? ` ${options.cls}` : ""}`,
    attr: { role: options.kind === "error" ? "alert" : "status" },
  });
  status.createSpan({ cls: "nox-status-message", text: options.text });

  if (options.action) {
    const action = createNoxButton(status, {
      cls: options.action.cls,
      label: options.action.label,
      text: options.action.label,
      variant: "quiet",
    });
    action.addEventListener("click", options.action.onClick);
  }

  return status;
}

export function createNoxMenuRow(
  parent: HTMLElement,
  options: NoxMenuRowOptions,
): HTMLButtonElement {
  const row = parent.createEl("button", {
    cls: `nox-menu-row${options.cls ? ` ${options.cls}` : ""}`,
    attr: {
      type: "button",
      role: "option",
      tabindex: "-1",
      "aria-selected": String(options.selected ?? false),
      ...(options.id ? { id: options.id } : {}),
    },
  });
  row.disabled = Boolean(options.disabled);
  row.toggleClass("is-selected", options.selected ?? false);

  if (options.icon) {
    const icon = row.createSpan({
      cls: `nox-menu-row-icon${options.iconClass ? ` ${options.iconClass}` : ""}`,
    });
    setNoxIcon(icon, options.icon);
  }
  row.createSpan({
    cls: `nox-menu-row-name${options.nameClass ? ` ${options.nameClass}` : ""}`,
    text: options.name,
  });
  if (options.description) {
    row.createSpan({
      cls: `nox-menu-row-description${options.descriptionClass ? ` ${options.descriptionClass}` : ""}`,
      text: options.description,
    });
  }
  if (options.command) {
    row.createSpan({
      cls: `nox-menu-row-command${options.commandClass ? ` ${options.commandClass}` : ""}`,
      text: options.command,
    });
  }
  if (options.trailingClass || options.trailingIcon) {
    const trailing = row.createSpan({
      cls: `nox-menu-row-trailing${options.trailingClass ? ` ${options.trailingClass}` : ""}`,
    });
    if (options.trailingIcon) setNoxIcon(trailing, options.trailingIcon);
  }

  return row;
}

export function createNoxMessageMeta(
  parent: HTMLElement,
  options: NoxMessageMetaOptions,
): { root: HTMLElement; time: HTMLElement | null } {
  const root = parent.createDiv({ cls: "nox-response-meta" });
  root.createSpan({ cls: "nox-response-label", text: options.label });
  root.createSpan({ cls: "nox-response-sub", text: options.sub });
  const time = options.time
    ? root.createSpan({ cls: "nox-response-time", text: options.time })
    : null;
  return { root, time };
}

export function createNoxSurface(
  parent: HTMLElement,
  className: string,
  variant: "card" | "approval" = "card",
): HTMLElement {
  return parent.createDiv({
    cls: `nox-surface nox-surface--${variant} ${className}`,
  });
}
