import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { NotifyToast } from "./NotifyToast";
import { useNotifyStore } from "@/stores/notifyStore";

describe("NotifyToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotifyStore.setState({ notice: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing until a notice is posted", () => {
    render(<NotifyToast />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the posted message", () => {
    render(<NotifyToast />);

    act(() => {
      useNotifyStore.getState().notify("檔案總管已更新");
    });

    expect(screen.getByRole("status")).toHaveTextContent("檔案總管已更新");
  });

  it("fades in, stays, then auto-dismisses after the full 4s lifecycle", () => {
    render(<NotifyToast />);
    act(() => {
      useNotifyStore.getState().notify("done");
    });

    // Mid-lifecycle (fade-in done, still in the 3s stay): visible.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Past enter (0.5s) + stay (3s) + exit (0.5s): gone.
    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is transparent while entering and while leaving", () => {
    render(<NotifyToast />);
    act(() => {
      useNotifyStore.getState().notify("done");
    });

    // Immediately after posting: mounted but still transparent (fade-in start).
    expect(screen.getByRole("status")).toHaveClass("opacity-0");

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByRole("status")).toHaveClass("opacity-100");

    // After enter + stay, the fade-out phase turns it transparent again.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("status")).toHaveClass("opacity-0");
  });

  it("restarts the lifecycle when the same message is posted again", () => {
    render(<NotifyToast />);
    act(() => {
      useNotifyStore.getState().notify("done");
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    act(() => {
      useNotifyStore.getState().notify("done");
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // 3s after the second post: still visible (fresh lifecycle).
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("closes early from the X button", () => {
    render(<NotifyToast />);
    act(() => {
      useNotifyStore.getState().notify("done");
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // The manual close plays the 0.5s fade-out, then unmounts.
    expect(screen.getByRole("status")).toHaveClass("opacity-0");
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
