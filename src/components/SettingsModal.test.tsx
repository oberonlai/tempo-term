import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { SettingsModal } from "./SettingsModal";
import { useUiStore } from "@/stores/uiStore";

// The settings body is a separate concern (and pulls in the whole settings UI);
// stub it so this test stays focused on the modal chrome's close behavior.
vi.mock("@/modules/settings/SettingsView", () => ({
  SettingsView: () => <div data-testid="settings-body">settings</div>,
}));

describe("SettingsModal", () => {
  beforeEach(() => {
    useUiStore.setState({ settingsOpen: true });
  });

  afterEach(() => {
    useUiStore.setState({ settingsOpen: false });
  });

  it("closes when Escape is pressed", () => {
    render(<SettingsModal />);

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("closes when the backdrop behind the panel is clicked", () => {
    const { container } = render(<SettingsModal />);

    // The outermost element is the dimmed backdrop.
    fireEvent.click(container.firstChild as HTMLElement);

    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("stays open when a click lands inside the panel", () => {
    render(<SettingsModal />);

    fireEvent.click(screen.getByTestId("settings-body"));

    expect(useUiStore.getState().settingsOpen).toBe(true);
  });
});
