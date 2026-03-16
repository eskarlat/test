import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SearchHighlight } from "./SearchHighlight";
import { TimeAgo } from "./TimeAgo";
import { EmptyState } from "./EmptyState";
import { BadgeDecision, BadgeIntent, BadgeAgent, BadgeStatus } from "./Badges";
import { BarChart } from "./BarChart";
import { ContributionCalendar } from "./ContributionCalendar";
import { PageHeader } from "./PageHeader";

describe("SearchHighlight", () => {
  it("renders text without highlight when query is empty", () => {
    render(<SearchHighlight text="hello world" query="" />);
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("highlights matching text", () => {
    const { container } = render(<SearchHighlight text="hello world" query="world" />);
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe("world");
  });

  it("handles regex special characters in query", () => {
    render(<SearchHighlight text="a+b" query="+" />);
    expect(screen.getByText("+")).toBeTruthy();
  });
});

describe("TimeAgo", () => {
  it("renders 'just now' for recent timestamps", () => {
    const now = new Date().toISOString();
    render(<TimeAgo timestamp={now} />);
    expect(screen.getByText("just now")).toBeTruthy();
  });

  it("renders minutes ago", () => {
    const d = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    render(<TimeAgo timestamp={d} />);
    expect(screen.getByText("5 minutes ago")).toBeTruthy();
  });

  it("renders hours ago", () => {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    render(<TimeAgo timestamp={d} />);
    expect(screen.getByText("3 hours ago")).toBeTruthy();
  });

  it("renders yesterday", () => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    render(<TimeAgo timestamp={d} />);
    expect(screen.getByText("yesterday")).toBeTruthy();
  });

  it("renders days ago", () => {
    const d = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    render(<TimeAgo timestamp={d} />);
    expect(screen.getByText("4 days ago")).toBeTruthy();
  });

  it("renders date for older timestamps", () => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { container } = render(<TimeAgo timestamp={d} />);
    // Should render month + day like "Feb 13"
    expect(container.textContent).toBeTruthy();
    expect(container.textContent).not.toBe("just now");
  });

  it("renders 1 minute ago (singular)", () => {
    const d = new Date(Date.now() - 61 * 1000).toISOString();
    render(<TimeAgo timestamp={d} />);
    expect(screen.getByText("1 minute ago")).toBeTruthy();
  });

  it("renders 1 hour ago (singular)", () => {
    const d = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    render(<TimeAgo timestamp={d} />);
    expect(screen.getByText("1 hour ago")).toBeTruthy();
  });
});

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No items" />);
    expect(screen.getByText("No items")).toBeTruthy();
  });

  it("renders description when provided", () => {
    render(<EmptyState title="Empty" description="Nothing to show" />);
    expect(screen.getByText("Nothing to show")).toBeTruthy();
  });

  it("renders action when provided", () => {
    render(<EmptyState title="Empty" action={<button>Add</button>} />);
    expect(screen.getByText("Add")).toBeTruthy();
  });

  it("renders icon when provided", () => {
    render(<EmptyState title="Empty" icon={<span data-testid="icon">I</span>} />);
    expect(screen.getByTestId("icon")).toBeTruthy();
  });
});

describe("Badges", () => {
  describe("BadgeDecision", () => {
    it("renders deny badge", () => {
      render(<BadgeDecision decision="deny" />);
      expect(screen.getByText("deny")).toBeTruthy();
    });

    it("renders allow badge", () => {
      render(<BadgeDecision decision="allow" />);
      expect(screen.getByText("allow")).toBeTruthy();
    });

    it("renders ask badge", () => {
      render(<BadgeDecision decision="ask" />);
      expect(screen.getByText("ask")).toBeTruthy();
    });
  });

  describe("BadgeIntent", () => {
    it("renders intent badge", () => {
      render(<BadgeIntent intent="code" />);
      expect(screen.getByText("code")).toBeTruthy();
    });

    it("handles unknown intent", () => {
      render(<BadgeIntent intent="unknown" />);
      expect(screen.getByText("unknown")).toBeTruthy();
    });
  });

  describe("BadgeAgent", () => {
    it("renders agent name", () => {
      render(<BadgeAgent agent="my-agent" />);
      expect(screen.getByText("my-agent")).toBeTruthy();
    });

    it("truncates long names", () => {
      render(<BadgeAgent agent="very-long-agent-name-here" />);
      // Truncated to 14 chars + ellipsis
      const el = screen.getByText(/very-long-agen/);
      expect(el.textContent).toContain("…");
    });
  });

  describe("BadgeStatus", () => {
    it("renders status", () => {
      render(<BadgeStatus status="active" />);
      expect(screen.getByText("active")).toBeTruthy();
    });

    it("handles unknown status", () => {
      render(<BadgeStatus status="custom" />);
      expect(screen.getByText("custom")).toBeTruthy();
    });
  });
});

describe("BarChart", () => {
  it("renders 'No data' when data is empty", () => {
    render(<BarChart data={[]} />);
    expect(screen.getByText("No data")).toBeTruthy();
  });

  it("renders chart when data is provided", () => {
    const { container } = render(
      <BarChart data={[{ label: "A", value: 10 }, { label: "B", value: 20 }]} />
    );
    // Recharts renders SVG elements
    expect(container.querySelector(".recharts-responsive-container")).toBeTruthy();
  });
});

describe("ContributionCalendar", () => {
  it("renders SVG calendar", () => {
    const { container } = render(
      <ContributionCalendar
        data={[{ date: "2025-01-01", count: 5 }]}
        weeks={4}
      />
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("renders legend with Less/More labels", () => {
    render(
      <ContributionCalendar
        data={[{ date: "2025-01-01", count: 1 }]}
        weeks={4}
      />
    );
    expect(screen.getByText("Less")).toBeTruthy();
    expect(screen.getByText("More")).toBeTruthy();
  });

  it("renders with empty data", () => {
    const { container } = render(
      <ContributionCalendar data={[]} weeks={4} />
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("PageHeader", () => {
  it("renders title", () => {
    render(<PageHeader title="My Page" />, { wrapper: MemoryRouter });
    expect(screen.getByText("My Page")).toBeTruthy();
  });

  it("renders description", () => {
    render(<PageHeader title="Page" description="A description" />, { wrapper: MemoryRouter });
    expect(screen.getByText("A description")).toBeTruthy();
  });

  it("renders breadcrumbs with links", () => {
    render(
      <PageHeader
        title="Page"
        breadcrumbs={[
          { label: "Home", to: "/" },
          { label: "Current" },
        ]}
      />,
      { wrapper: MemoryRouter },
    );
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
  });

  it("renders actions", () => {
    render(
      <PageHeader title="Page" actions={<button>Action</button>} />,
      { wrapper: MemoryRouter },
    );
    expect(screen.getByText("Action")).toBeTruthy();
  });
});
