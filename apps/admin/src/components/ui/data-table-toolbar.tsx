"use client";

import { ReactNode } from "react";
import { ListFilter } from "lucide-react";
import { Input } from "./input";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./dropdown-menu";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDropdownProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function FilterDropdown({ label, options, selected, onChange }: FilterDropdownProps) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <ListFilter className="h-3.5 w-3.5" />
          {label}
          {selected.length > 0 && <span className="rounded-pill bg-accent-soft px-1.5 text-accent-ink">{selected.length}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            onCheckedChange={() => toggle(option.value)}
            onSelect={(e) => e.preventDefault()}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DataTableToolbar({
  filterValue,
  onFilterChange,
  filterPlaceholder = "Filtrar...",
  filters,
  actions,
  selectionCount,
}: {
  filterValue: string;
  onFilterChange: (value: string) => void;
  filterPlaceholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
  selectionCount?: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filterValue}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={filterPlaceholder}
          className="h-8 w-56"
        />
        {filters}
        {typeof selectionCount === "number" && selectionCount > 0 && (
          <span className="text-xs text-ink-soft">{selectionCount} selecionado(s)</span>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
