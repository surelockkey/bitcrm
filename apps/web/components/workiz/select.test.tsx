import { useEffect, useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { WzMultiSelect, WzSelect, type WzOption } from "./select";

const JOB_TYPES: WzOption[] = [
  { value: "svc", label: "Service" },
  { value: "safe", label: "Safe" },
  { value: "rekey", label: "Rekey lock" },
  { value: "na", label: "N/A" },
  { value: "moto", label: "Motorcycle / Boat / House key" },
  { value: "lockout", label: "Lockout" },
  { value: "ign", label: "Key Stuck In The Ignition" },
  { value: "house", label: "House Lockout" },
  { value: "car", label: "Car lockout" },
];

const combo = (name = "Job type") => screen.getByRole("combobox", { name });
/** The box the user clicks: the input floats over it, so find it through the root. */
const control = (name = "Job type") =>
  combo(name).closest("[data-slot=wz-select]")!.querySelector("[data-slot=wz-select-control]") as HTMLElement;
const listbox = () => screen.getByRole("listbox");
const optionLabels = () =>
  within(listbox())
    .getAllByRole("option")
    .map((o) => o.textContent);
const active = () => {
  const id = combo().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.textContent : null;
};

function Uncontrolled(props: Partial<Parameters<typeof WzSelect>[0]>) {
  return <WzSelect label="Job type" options={JOB_TYPES} {...props} />;
}

describe("WzSelect — wiring", () => {
  it("is a combobox named by a real <label>", () => {
    render(<Uncontrolled />);
    const input = combo();
    const label = screen.getByText("Job type");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", input.id);
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
  });

  it("uses the label as the placeholder while empty and floats it over a value", () => {
    const { rerender } = render(<WzSelect label="Job type" options={JOB_TYPES} value="" />);
    const root = combo().closest("[data-slot=wz-select]") as HTMLElement;
    expect(root).toHaveAttribute("data-has-value", "false");
    expect(screen.queryByText("Service")).not.toBeInTheDocument();
    rerender(<WzSelect label="Job type" options={JOB_TYPES} value="svc" />);
    expect(root).toHaveAttribute("data-has-value", "true");
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("Job type").tagName).toBe("LABEL");
  });

  it("shows a value that is not among the options by its fallback label", () => {
    render(<WzSelect label="Job type" options={JOB_TYPES} value="old" valueLabel="Old type (archived)" />);
    expect(screen.getByText("Old type (archived)")).toBeInTheDocument();
  });
});

describe("WzSelect — opening and keyboard", () => {
  it("opens on a click with every option in catalog order", async () => {
    render(<Uncontrolled />);
    await userEvent.click(control());
    expect(combo()).toHaveAttribute("aria-expanded", "true");
    expect(combo()).toHaveAttribute("aria-controls", listbox().id);
    expect(optionLabels()).toEqual(JOB_TYPES.map((o) => o.label));
    // react-select focuses the first option on open.
    expect(active()).toBe("Service");
  });

  it("closes on a second click on the control", async () => {
    render(<Uncontrolled />);
    await userEvent.click(control());
    await userEvent.click(control());
    expect(combo()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on ArrowDown at the first option and on ArrowUp at the last", async () => {
    render(<Uncontrolled />);
    act(() => combo().focus());
    await userEvent.keyboard("{ArrowDown}");
    expect(active()).toBe("Service");
    await userEvent.keyboard("{Escape}");
    expect(combo()).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{ArrowUp}");
    expect(active()).toBe("Car lockout");
  });

  it("moves with the arrows (wrapping), Home/End and PageUp/PageDown", async () => {
    render(<Uncontrolled />);
    act(() => combo().focus());
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(active()).toBe("Safe");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(active()).toBe("Car lockout");
    await userEvent.keyboard("{ArrowDown}");
    expect(active()).toBe("Service");
    await userEvent.keyboard("{PageDown}");
    expect(active()).toBe("Lockout");
    await userEvent.keyboard("{PageDown}");
    expect(active()).toBe("Car lockout");
    await userEvent.keyboard("{PageUp}");
    expect(active()).toBe("N/A");
    await userEvent.keyboard("{Home}");
    expect(active()).toBe("Service");
    await userEvent.keyboard("{End}");
    expect(active()).toBe("Car lockout");
  });

  it("follows the mouse", async () => {
    render(<Uncontrolled />);
    await userEvent.click(control());
    await userEvent.hover(screen.getByRole("option", { name: "Lockout" }));
    expect(active()).toBe("Lockout");
  });

  it("picks the focused option on Enter, closes, and shows it", async () => {
    const onChange = vi.fn();
    render(<Uncontrolled onChange={onChange} />);
    act(() => combo().focus());
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("rekey");
    expect(combo()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Rekey lock")).toBeInTheDocument();
    expect(document.activeElement).toBe(combo());
  });

  it("picks the focused option on Tab, as react-select does", async () => {
    const onChange = vi.fn();
    render(
      <>
        <Uncontrolled onChange={onChange} />
        <button type="button">next</button>
      </>,
    );
    act(() => combo().focus());
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith("safe");
  });

  it("picks an option on click", async () => {
    const onChange = vi.fn();
    render(<Uncontrolled onChange={onChange} />);
    await userEvent.click(control());
    await userEvent.click(screen.getByRole("option", { name: "House Lockout" }));
    expect(onChange).toHaveBeenCalledWith("house");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByText("House Lockout")).toBeInTheDocument();
  });

  it("marks the chosen option and focuses it when reopened", async () => {
    render(<WzSelect label="Job type" options={JOB_TYPES} value="lockout" onChange={() => {}} />);
    await userEvent.click(control());
    expect(screen.getByRole("option", { name: "Lockout" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Service" })).toHaveAttribute("aria-selected", "false");
    expect(active()).toBe("Lockout");
  });

  it("closes on Escape without changing anything", async () => {
    const onChange = vi.fn();
    render(<Uncontrolled onChange={onChange} />);
    await userEvent.click(control());
    await userEvent.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes and reports blur when focus leaves", async () => {
    const onBlur = vi.fn();
    render(
      <>
        <Uncontrolled onBlur={onBlur} />
        <button type="button">elsewhere</button>
      </>,
    );
    await userEvent.click(control());
    await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onBlur).toHaveBeenCalled();
  });
});

describe("WzSelect — typing to filter", () => {
  it("keeps the options whose label contains the text, in order, and focuses the first", async () => {
    render(<Uncontrolled />);
    act(() => combo().focus());
    await userEvent.keyboard("lock");
    expect(combo()).toHaveAttribute("aria-expanded", "true");
    expect(optionLabels()).toEqual(["Rekey lock", "Lockout", "House Lockout", "Car lockout"]);
    expect(active()).toBe("Rekey lock");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("Lockout")).toBeInTheDocument();
    // The typed text is gone once something is picked.
    expect(combo()).toHaveValue("");
  });

  it("ignores case and surrounding spaces", async () => {
    render(<Uncontrolled />);
    act(() => combo().focus());
    await userEvent.keyboard("  SAFE ");
    expect(optionLabels()).toEqual(["Safe"]);
  });

  it("says No options when nothing matches", async () => {
    render(<Uncontrolled />);
    act(() => combo().focus());
    await userEvent.keyboard("zzz");
    expect(screen.getByText("No options")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("hands the text to the caller and skips local filtering for server search", async () => {
    const onInputChange = vi.fn();
    render(<Uncontrolled filterOption={null} onInputChange={onInputChange} />);
    act(() => combo().focus());
    await userEvent.keyboard("zz");
    expect(onInputChange).toHaveBeenLastCalledWith("zz");
    expect(optionLabels()).toHaveLength(JOB_TYPES.length);
  });

  it("clears the typed text on Escape and on blur", async () => {
    render(<Uncontrolled />);
    act(() => combo().focus());
    await userEvent.keyboard("saf{Escape}");
    expect(combo()).toHaveValue("");
    await userEvent.keyboard("saf");
    act(() => combo().blur());
    expect(combo()).toHaveValue("");
  });

  it("can be read-only to typing (searchable=false)", async () => {
    render(<Uncontrolled searchable={false} />);
    act(() => combo().focus());
    await userEvent.keyboard("saf");
    expect(combo()).toHaveValue("");
  });
});

describe("WzSelect — clearing", () => {
  it("offers a clear × only when there is a value and it is clearable", () => {
    const { rerender } = render(<WzSelect label="Job source" options={JOB_TYPES} value="svc" clearable />);
    expect(screen.getByRole("button", { name: "Clear Job source" })).toBeInTheDocument();
    rerender(<WzSelect label="Job source" options={JOB_TYPES} value="" clearable />);
    expect(screen.queryByRole("button", { name: "Clear Job source" })).not.toBeInTheDocument();
    rerender(<WzSelect label="Job source" options={JOB_TYPES} value="svc" />);
    expect(screen.queryByRole("button", { name: "Clear Job source" })).not.toBeInTheDocument();
  });

  it("clears with the × without opening the menu", async () => {
    const onChange = vi.fn();
    render(<WzSelect label="Job source" options={JOB_TYPES} value="svc" clearable onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear Job source" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("clears with Backspace on an empty input when clearable", async () => {
    const onChange = vi.fn();
    render(<WzSelect label="Job source" options={JOB_TYPES} value="svc" clearable onChange={onChange} />);
    act(() => combo("Job source").focus());
    await userEvent.keyboard("{Backspace}");
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not clear with Backspace when not clearable", async () => {
    const onChange = vi.fn();
    render(<WzSelect label="Job type" options={JOB_TYPES} value="svc" onChange={onChange} />);
    act(() => combo().focus());
    await userEvent.keyboard("{Backspace}");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("WzSelect — disabled", () => {
  it("cannot be opened, typed in or cleared", async () => {
    const onChange = vi.fn();
    render(<WzSelect label="Job type" options={JOB_TYPES} value="svc" clearable disabled onChange={onChange} />);
    expect(combo()).toBeDisabled();
    await userEvent.click(control());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear/ })).not.toBeInTheDocument();
    expect(combo().closest("[data-slot=wz-select]")).toHaveAttribute("data-disabled", "true");
  });

  it("skips disabled options", async () => {
    const onChange = vi.fn();
    render(
      <Uncontrolled
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Bravo", disabled: true },
          { value: "c", label: "Charlie" },
        ]}
        onChange={onChange}
      />,
    );
    act(() => combo().focus());
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(active()).toBe("Charlie");
    await userEvent.click(screen.getByRole("option", { name: "Bravo" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("WzSelect — controlled, uncontrolled, forms", () => {
  it("works uncontrolled from a defaultValue", async () => {
    render(<Uncontrolled defaultValue="safe" />);
    expect(screen.getByText("Safe")).toBeInTheDocument();
    await userEvent.click(control());
    await userEvent.click(screen.getByRole("option", { name: "Lockout" }));
    expect(screen.getByText("Lockout")).toBeInTheDocument();
  });

  it("works controlled", async () => {
    function C() {
      const [v, setV] = useState("svc");
      return (
        <>
          <WzSelect label="Job type" options={JOB_TYPES} value={v} onChange={setV} />
          <output>{v}</output>
        </>
      );
    }
    render(<C />);
    await userEvent.click(control());
    await userEvent.click(screen.getByRole("option", { name: "Car lockout" }));
    expect(screen.getByRole("status")).toHaveTextContent("car");
  });

  it("posts its value with a native form through a hidden input", () => {
    const { container } = render(
      <WzSelect label="Job type" name="jobTypeId" options={JOB_TYPES} value="safe" onChange={() => {}} />,
    );
    const hidden = container.querySelector('input[type="hidden"][name="jobTypeId"]') as HTMLInputElement;
    expect(hidden.value).toBe("safe");
  });

  it("drops into react-hook-form's Controller (value, onChange, onBlur, name, ref)", async () => {
    const onSubmit = vi.fn();
    const seen: { api?: UseFormReturn<{ jobTypeId: string }>; touched: boolean } = { touched: false };
    function Form() {
      const form = useForm<{ jobTypeId: string }>({ defaultValues: { jobTypeId: "" } });
      const touched = !!form.formState.touchedFields.jobTypeId;
      useEffect(() => {
        seen.api = form;
        seen.touched = touched;
      });
      return (
        <form onSubmit={form.handleSubmit((v) => onSubmit(v))}>
          <Controller
            name="jobTypeId"
            control={form.control}
            render={({ field }) => <WzSelect label="Job type" options={JOB_TYPES} {...field} />}
          />
          <button type="submit">Create</button>
        </form>
      );
    }
    render(<Form />);
    await userEvent.click(control());
    await userEvent.click(screen.getByRole("option", { name: "Safe" }));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).toHaveBeenCalledWith({ jobTypeId: "safe" });
    expect(seen.touched).toBe(true);
    // setFocus defers to a timer in react-hook-form 7.80.
    act(() => seen.api!.setFocus("jobTypeId"));
    await waitFor(() => expect(document.activeElement).toBe(combo()));
    act(() => seen.api!.setValue("jobTypeId", "car"));
    expect(screen.getByText("Car lockout")).toBeInTheDocument();
  });

  it("shows and ties a validation message", () => {
    render(<Uncontrolled error="Required field" />);
    expect(combo()).toHaveAttribute("aria-invalid", "true");
    expect(combo()).toHaveAttribute("aria-describedby", screen.getByText("Required field").id);
  });
});

describe("WzSelect — an action row", () => {
  it("puts '+ Add new' first and hands it the typed text", async () => {
    const onCreate = vi.fn();
    const onChange = vi.fn();
    render(<Uncontrolled onChange={onChange} createOption={{ onCreate }} />);
    await userEvent.click(control());
    expect(optionLabels()[0]).toBe("+ Add new");
    expect(active()).toBe("+ Add new");
    await userEvent.keyboard("Tow{Enter}");
    expect(onCreate).toHaveBeenCalledWith("Tow");
    expect(onChange).not.toHaveBeenCalled();
  });
});

const TECHS: WzOption[] = [
  { value: "t1", label: "Daniel Munoz" },
  { value: "t2", label: "Tracy Np" },
  { value: "t3", label: "Ali Khan" },
];

describe("WzMultiSelect", () => {
  const multi = () => screen.getByRole("combobox", { name: "Assign team members" });

  it("is labelled and shows the label as its placeholder while empty", () => {
    render(<WzMultiSelect label="Assign team members" options={TECHS} />);
    expect(screen.getByText("Assign team members").tagName).toBe("LABEL");
    expect(multi()).toHaveAttribute("aria-expanded", "false");
  });

  it("marks its list as multi-selectable", async () => {
    render(<WzMultiSelect label="Assign team members" options={TECHS} />);
    await userEvent.click(multi().closest("[data-slot=wz-select-control]") as HTMLElement);
    expect(listbox()).toHaveAttribute("aria-multiselectable", "true");
  });

  it("adds picks as chips and hides them from the list", async () => {
    const onChange = vi.fn();
    function C() {
      const [v, setV] = useState<string[]>([]);
      return (
        <WzMultiSelect
          label="Assign team members"
          options={TECHS}
          value={v}
          onChange={(next) => {
            onChange(next);
            setV(next);
          }}
        />
      );
    }
    render(<C />);
    await userEvent.click(multi().closest("[data-slot=wz-select-control]") as HTMLElement);
    await userEvent.click(screen.getByRole("option", { name: "Tracy Np" }));
    expect(onChange).toHaveBeenLastCalledWith(["t2"]);
    expect(screen.getByRole("button", { name: "Remove Tracy Np" })).toBeInTheDocument();
    await userEvent.click(multi().closest("[data-slot=wz-select-control]") as HTMLElement);
    expect(optionLabels()).toEqual(["Daniel Munoz", "Ali Khan"]);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["t2", "t3"]);
  });

  it("removes a chip with its ×", async () => {
    const onChange = vi.fn();
    render(<WzMultiSelect label="Assign team members" options={TECHS} value={["t1", "t3"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Daniel Munoz" }));
    expect(onChange).toHaveBeenCalledWith(["t3"]);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("removes the last chip with Backspace on an empty input", async () => {
    const onChange = vi.fn();
    render(<WzMultiSelect label="Assign team members" options={TECHS} value={["t1", "t3"]} onChange={onChange} />);
    act(() => multi().focus());
    await userEvent.keyboard("{Backspace}");
    expect(onChange).toHaveBeenCalledWith(["t1"]);
  });

  it("says No options when everything is taken or nothing is offered", async () => {
    render(<WzMultiSelect label="Assign team members" options={[]} />);
    await userEvent.click(multi().closest("[data-slot=wz-select-control]") as HTMLElement);
    expect(screen.getByText("No options")).toBeInTheDocument();
  });

  it("drops into react-hook-form's Controller", async () => {
    const onSubmit = vi.fn();
    function Form() {
      const form = useForm<{ techIds: string[] }>({ defaultValues: { techIds: ["t1"] } });
      return (
        <form onSubmit={form.handleSubmit((v) => onSubmit(v))}>
          <Controller
            name="techIds"
            control={form.control}
            render={({ field }) => <WzMultiSelect label="Assign team members" options={TECHS} {...field} />}
          />
          <button type="submit">Create</button>
        </form>
      );
    }
    render(<Form />);
    await userEvent.click(multi().closest("[data-slot=wz-select-control]") as HTMLElement);
    await userEvent.click(screen.getByRole("option", { name: "Ali Khan" }));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).toHaveBeenCalledWith({ techIds: ["t1", "t3"] });
  });

  it("cannot be changed while disabled", async () => {
    render(<WzMultiSelect label="Assign team members" options={TECHS} value={["t1"]} disabled />);
    expect(multi()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Remove Daniel Munoz" })).not.toBeInTheDocument();
  });
});
