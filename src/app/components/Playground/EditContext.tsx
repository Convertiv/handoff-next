'use client';

import { createContext, ReactNode, RefObject, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { renderHandlebarsPreview, renderPreview, renderReactPreview } from './Preview';
import { SelectedPlaygroundComponent } from './types';
import { applyCapabilitiesToProperties, readCapabilities } from '@/lib/slot-capabilities';
import { imageFieldWrites } from '@/lib/image-field-write';

interface ImageDimensionRules {
  min?: { width: number; height: number };
  max?: { width: number; height: number };
  recommended?: { width: number; height: number };
}

interface EditContextType {
  component: SelectedPlaygroundComponent | null;
  data: any;
  setData: (data: any) => void;
  properties: any;
  previewHtml: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  mediaBrowserOpen: boolean;
  setMediaBrowserOpen: (open: boolean) => void;
  currentImagePath: string[];
  setCurrentImagePath: (path: string[]) => void;
  currentImageRules: ImageDimensionRules | null;
  setCurrentImageRules: (rules: ImageDimensionRules | null) => void;
  /** True when the open picker's target holds a bare URL string rather than an image object. */
  currentImageScalar: boolean;
  setCurrentImageScalar: (scalar: boolean) => void;
  getData: (path: string[], localData?: any) => any;
  handleInputChange: (path: string[], value: any) => any;
  handleMediaSelect: (image: { src: string; srcset: string; alt: string }) => void;
  handleSave: () => void;
}

const EditContext = createContext<EditContextType | undefined>(undefined);

export function EditContextProvider({
  component,
  onCommit,
  targetIframeRef,
  children,
}: {
  component: SelectedPlaygroundComponent | null;
  /** Where a save goes. Playground passes updateComponent; the preview builder
   *  passes its registry-save. Decouples this context from PlaygroundContext so
   *  both surfaces share the field builder + preview frame. */
  onCommit?: (updated: SelectedPlaygroundComponent) => void | Promise<void>;
  /** An external preview iframe to also receive live prop updates — e.g. the
   *  playground canvas. Lets the right-panel editor (which mounts no <Preview>
   *  of its own) live-update the real page canvas via postMessage instead of
   *  forcing a full canvas rebuild on every "Apply". */
  targetIframeRef?: RefObject<HTMLIFrameElement | null>;
  children: ReactNode;
}) {
  const [data, setData] = useState<any>(null);
  const [properties, setProperties] = useState<any>({});
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [mediaBrowserOpen, setMediaBrowserOpen] = useState(false);
  const [currentImagePath, setCurrentImagePath] = useState<string[]>([]);
  const [currentImageRules, setCurrentImageRules] = useState<ImageDimensionRules | null>(null);
  const [currentImageScalar, setCurrentImageScalar] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initialRenderDone = useRef(false);

  const basePath = typeof process !== 'undefined' ? process.env.HANDOFF_APP_BASE_PATH ?? '' : '';
  const isReact = component?.format === 'react';

  useEffect(() => {
    if (component) {
      setData(component.data);
      // Overlay what the component's slots were measured to accept. Without this the editor renders
      // from the declared schema alone — a slot the component takes as `{ src, alt }` gets a slot
      // editor, while MCP and the chat correctly show an image field. See `lib/slot-capabilities.ts`.
      // Read the record explicitly rather than passing `component`: here `data` holds the block's
      // authored args, not the component row, so the reader's `data.capabilities` fallback would be
      // looking in the wrong place.
      setProperties(
        applyCapabilitiesToProperties(
          component.properties,
          readCapabilities({ capabilities: component.capabilities }),
          component.fields
        )
      );
      initialRenderDone.current = false;

      if (isReact) {
        setPreviewHtml(renderReactPreview(component, component.data, basePath, component.uniqueId));
      } else {
        setPreviewHtml(renderHandlebarsPreview(component, component.data, basePath));
      }
    }
  }, [component, basePath, isReact]);

  useEffect(() => {
    if (!component || data === null) return;

    if (isReact) {
      if (!initialRenderDone.current) {
        initialRenderDone.current = true;
        return;
      }
      // For React: send props update via postMessage to avoid reloading the
      // module. Post to the local preview iframe (EditSheet) AND any external
      // target (the playground canvas), deduped. Each block's listener filters
      // on blockId, so posting to a frame that lacks this block is a no-op.
      const windows = [iframeRef.current?.contentWindow, targetIframeRef?.current?.contentWindow];
      const seen = new Set<Window>();
      for (const w of windows) {
        if (w && !seen.has(w)) {
          seen.add(w);
          w.postMessage({ type: 'update-props', props: data, blockId: component.uniqueId }, '*');
        }
      }
    } else {
      const html = renderHandlebarsPreview(component, data, basePath);
      setPreviewHtml(html);
    }
  }, [data, component, basePath, isReact]);

  const handleInputChange = useCallback(
    (path: string[], value: any) => {
      const target = path[path.length - 1];
      setData((prev: any) => {
        // Immutable path-set: clone each node along the path so we never mutate
        // previous state, and replace any NON-OBJECT intermediate with a fresh
        // object. The old code descended into whatever was there — so writing
        // e.g. `imageSrc.src` when `imageSrc` held a string URL threw
        // "Cannot create property 'src' on string" and crashed the app.
        const clone = (node: any) => (Array.isArray(node) ? [...node] : { ...(node ?? {}) });
        const next = clone(prev);
        let current = next;
        for (let i = 0; i < path.length - 1; i++) {
          const key = path[i];
          const child = current[key];
          current[key] = child && typeof child === 'object' ? clone(child) : {};
          current = current[key];
        }
        current[target] = value;
        return next;
      });
      return value;
    },
    []
  );

  const getData = useCallback(
    (path: string[], localData?: any) => {
      let current = localData || data;
      for (let i = 0; i < path.length; i++) {
        if (!current) return null;
        if (current[path[i]]) {
          current = current[path[i]];
        } else {
          current = null;
        }
      }
      return current;
    },
    [data]
  );

  const handleMediaSelect = useCallback(
    (image: { src: string; srcset: string; alt: string }) => {
      if (currentImagePath.length > 0) {
        // Shared with the field's own picker and generate flow — see `imageFieldWrites`. When the target is
        // an image item's `src`, the value written is the URL itself; writing the object there is what
        // produced `<img src="[object Object]">`.
        for (const [path, v] of imageFieldWrites(currentImagePath, image, currentImageScalar)) {
          handleInputChange(path, v);
        }
      }
      setMediaBrowserOpen(false);
    },
    [currentImagePath, currentImageScalar, handleInputChange]
  );

  const handleSave = useCallback(async () => {
    if (!component) return;
    const updatedComponent = { ...component, data };
    updatedComponent.rendered = await renderPreview(updatedComponent, data, basePath);
    await onCommit?.(updatedComponent);
  }, [component, data, onCommit, basePath]);

  return (
    <EditContext.Provider
      value={{
        component,
        data,
        setData,
        properties,
        previewHtml,
        iframeRef,
        mediaBrowserOpen,
        setMediaBrowserOpen,
        currentImagePath,
        setCurrentImagePath,
        currentImageRules,
        setCurrentImageRules,
        currentImageScalar,
        setCurrentImageScalar,
        getData,
        handleInputChange,
        handleMediaSelect,
        handleSave,
      }}
    >
      {children}
    </EditContext.Provider>
  );
}

export function useEditContext() {
  const context = useContext(EditContext);
  if (context === undefined) {
    throw new Error('useEditContext must be used within an EditContextProvider');
  }
  return context;
}
