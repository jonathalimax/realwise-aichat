import { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { inputClasses } from "./input";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClasses, "py-2.5", className)} {...props} />;
}
