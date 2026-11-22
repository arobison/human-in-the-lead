// React hooks over the dashboard data contract (HITLD-729, decision HITLD-721), for HITLD's page
// and a project's own app. A ContractProvider (or HitldRoot, components.mjs) holds one contract;
// the hooks read it. useLoadContract loads one from a URL, a loader or an object.

import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import {
  fetchContract,
  fieldGetter,
  itemOf,
  itemsOf,
  panelOf,
  panelsOf,
  readContract,
  readStamp,
} from './client.mjs';

/**
 * @typedef {import('./client.mjs').Contract} Contract
 * @typedef {import('./client.mjs').ContractItem} ContractItem
 * @typedef {{ contract: Contract, fileBase: string | null }} ContractState
 */

/** The contract the components below a provider read. */
export const ContractContext = createContext(/** @type {ContractState | null} */ (null));

/**
 * Hold one contract for the components and hooks below.
 * @param {{ contract: Contract, fileBase?: string | null, children?: import('react').ReactNode }} props
 */
export function ContractProvider({ contract, fileBase = null, children }) {
  const value = useMemo(() => ({ contract, fileBase }), [contract, fileBase]);
  return createElement(ContractContext.Provider, { value }, children);
}

/** The provider's state; fails outside one, naming the fix. @returns {ContractState} */
function useProvided() {
  const s = useContext(ContractContext);
  if (!s) throw new Error('no contract: wrap the component in ContractProvider or HitldRoot');
  return s;
}

/** The contract the nearest provider holds. @returns {Contract} */
export const useContract = () => useProvided().contract;

/** Where the repository's files are linked: the forge's address, or null. */
export const useFileBase = () => useProvided().fileBase;

/**
 * The contract's items, those a test keeps when one is given. Pass a stable test (from useCallback
 * or outside the component) so the list is not rebuilt on every render.
 * @param {(it: ContractItem) => boolean} [keep] @returns {ContractItem[]}
 */
export function useItems(keep) {
  const c = useContract();
  return useMemo(() => (keep ? itemsOf(c).filter(keep) : itemsOf(c)), [c, keep]);
}

/** One item, or null. @param {string} id */
export const useItem = (id) => itemOf(useContract(), id);

/** The project's resolved panels. */
export const usePanels = () => panelsOf(useContract());

/** One resolved panel, or null. @param {string} id */
export const usePanel = (id) => panelOf(useContract(), id);

/**
 * A getter for a field by its views.json name; an unknown name throws, naming it.
 * @param {string} name
 */
export function useField(name) {
  const c = useContract();
  return useMemo(() => fieldGetter(c, name), [c, name]);
}

/** When and where the contract's data was read. */
export function useReadStamp() {
  const c = useContract();
  return useMemo(() => readStamp(c), [c]);
}

/**
 * Load a contract: from a URL (the JSON `hitld dashboard --json --no-write` writes), a loader that
 * resolves to one, or a contract object or its text. It is checked by readContract.
 * @param {string | (() => Promise<unknown>) | unknown} source
 * @returns {{ contract: Contract | null, error: Error | null, loading: boolean }}
 */
export function useLoadContract(source) {
  const [state, setState] = useState(
    /** @type {{ contract: Contract | null, error: Error | null, loading: boolean }} */ ({
      contract: null,
      error: null,
      loading: true,
    }),
  );
  useEffect(() => {
    let live = true;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    setState({ contract: null, error: null, loading: true });
    const load =
      typeof source === 'string' && !source.trimStart().startsWith('{')
        ? fetchContract(source, ac ? { signal: ac.signal } : {})
        : typeof source === 'function'
          ? Promise.resolve(source()).then(readContract)
          : Promise.resolve(source).then(readContract);
    load.then(
      (contract) => live && setState({ contract, error: null, loading: false }),
      (e) =>
        live &&
        setState({
          contract: null,
          error: e instanceof Error ? e : new Error(String(e)),
          loading: false,
        }),
    );
    return () => {
      live = false;
      ac?.abort();
    };
  }, [source]);
  return state;
}
