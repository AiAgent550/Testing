// Module: customers. Routes are registered here; logic other modules may call lives in service.ts.
import type { Module } from "../types";

const customers: Module = {
  name: "customers",
  register(_r) {
    // Implemented in its build stage.
  },
};
export default customers;
