"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
    value: string;
    label: string;
    group?: string;
    disabled?: boolean;
}

interface SelectProps {
    id?: string;
    label: string;
    title?: string;
    value: string;
    options: readonly SelectOption[];
    disabled?: boolean;
    onValueChange: (value: string) => void;
    portalContainer?: SelectPrimitive.Portal.Props["container"];
}

/** Shared, keyboard-accessible dropdown; values remain owned by the caller. */
export function Select({ id, label, title, value, options, disabled, onValueChange, portalContainer }: SelectProps) {
    const groups = [...new Set(options.map(option => option.group))];
    const renderOption = (option: SelectOption) => (
        <SelectPrimitive.Item key={option.value} value={option.value} label={option.label} disabled={option.disabled} className="dropdown-option">
            <SelectPrimitive.ItemText className="dropdown-option-text">{option.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="dropdown-check"><Check size={16} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
        </SelectPrimitive.Item>
    );

    return <SelectPrimitive.Root<string> items={options} value={value} disabled={disabled} modal={false} onValueChange={next => { if (next !== null) onValueChange(next); }}>
        <SelectPrimitive.Trigger id={id} className="dropdown-trigger" aria-label={label} title={title ?? options.find(option => option.value === value)?.label}>
            <SelectPrimitive.Value className="dropdown-value" />
            <SelectPrimitive.Icon className="dropdown-chevron"><ChevronDown size={16} aria-hidden="true" /></SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal container={portalContainer}>
            <SelectPrimitive.Positioner className="dropdown-positioner" align="start" sideOffset={8} collisionPadding={12} alignItemWithTrigger={false} positionMethod="fixed">
                <SelectPrimitive.Popup className="dropdown-popup">
                    <SelectPrimitive.List className="dropdown-list" aria-label={label}>
                        {groups.map(group => group === undefined
                            ? options.filter(option => option.group === undefined).map(renderOption)
                            : <SelectPrimitive.Group key={group} className="dropdown-group">
                                <SelectPrimitive.GroupLabel className="dropdown-group-label">{group}</SelectPrimitive.GroupLabel>
                                {options.filter(option => option.group === group).map(renderOption)}
                            </SelectPrimitive.Group>)}
                    </SelectPrimitive.List>
                </SelectPrimitive.Popup>
            </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
    </SelectPrimitive.Root>;
}