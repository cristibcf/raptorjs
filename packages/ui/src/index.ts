/**
 * @raptor/ui - componente reutilizabile peste runtime-ul fine-grained.
 *
 * Sunt construite cu `R` din @raptor/dom (deci fara build step) si respecta
 * aceeasi regula ca restul stack-ului: nimic nu se re-randeaza, fiecare bucata
 * dinamica e un binding care atinge exact un atribut / text-node / rand.
 *
 * Stilurile sunt optionale si separate (`@raptor/ui/styles`): componentele pun
 * doar clase si atribute ARIA, nu impun CSS.
 */
export { Table, type Column, type TableProps, type SortState } from "./table.ts";
export {
  DropdownMenu,
  menuItem,
  menuSeparator,
  type MenuEntry,
  type MenuItem,
  type DropdownMenuProps,
} from "./menu.ts";
export { Progress, CircularProgress, type ProgressProps, type CircularProgressProps } from "./progress.ts";
export { Slider, RangeSlider, type SliderProps, type RangeSliderProps } from "./slider.ts";
export { Sparkline, type SparklineProps } from "./sparkline.ts";
export { SplitPane, splitPane, type SplitPaneProps, type SplitPane as SplitPaneHandle } from "./split-pane.ts";
export { Combobox, combobox, type ComboboxProps, type Combobox as ComboboxHandle } from "./combobox.ts";
export { DataGrid, dataGrid, type DataGridProps, type GridColumn, type DataGrid as DataGridHandle } from "./data-grid.ts";
export { Button, IconButton, ButtonGroup, type ButtonProps, type IconButtonProps, type ButtonGroupProps, type ButtonVariant, type ButtonSize } from "./button.ts";
export { Input, Textarea, Checkbox, Switch, RadioGroup, type InputProps, type TextareaProps, type CheckboxProps, type SwitchProps, type RadioGroupProps, type RadioOption } from "./input.ts";
export { Select, select, type SelectProps, type SelectHandle } from "./select.ts";
export { Form, FormField, FormSection, Label, ErrorMessage, ValidationSummary, field, formGroup, validators, type FormProps, type FormFieldProps, type FormSectionProps, type LabelProps, type ErrorMessageProps, type ValidationSummaryProps, type Field, type FieldOptions, type FormGroup, type Validator } from "./form.ts";
export { Dialog, ConfirmDialog, Popover, Tooltip, type DialogProps, type ConfirmDialogProps, type PopoverProps, type TooltipProps } from "./overlay.ts";
export { Toaster, createToaster, type ToasterProps, type ToasterOptions, type Toaster as ToasterStore, type ToastItem, type ToastOptions, type ToastKind } from "./toast.ts";
export { Tabs, tabs, type TabsProps, type Tab, type TabsHandle } from "./tabs.ts";
export * from "./layout.ts";
export * from "./date.ts";
export * from "./layout-extra.ts";
export * from "./input-extra.ts";
export * from "./navigation.ts";
export * from "./data-views.ts";
export * from "./files.ts";
export * from "./overlay-extra.ts";
export * from "./chart.ts";
export * from "./chart-extra.ts";
export * from "./editors.ts";
export * from "./media.ts";
export * from "./qrcode.ts";
export * from "./advanced.ts";
export * from "./display.ts";
export * from "./disclosure.ts";
export * from "./controls.ts";
export * from "./typography.ts";
export * from "./primitives/index.ts";
