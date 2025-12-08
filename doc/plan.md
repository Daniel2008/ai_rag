# UI Optimization Plan

## 1. Sidebar Refactoring
- **Goal**: Extract the sidebar logic and UI from `App.tsx` into a dedicated `AppSidebar.tsx` component.
- **Current State**: The sidebar is currently part of the `App` component in `App.tsx`, mixing logic for collections, file management, and UI rendering.
- **Action Items**:
    - Create `src/renderer/src/components/AppSidebar.tsx`.
    - Move `Conversations`, `Card` (collection details), and `Welcome` (empty state) components into `AppSidebar`.
    - Define props for `AppSidebar` to handle state (collections, activeCollectionId, etc.) and actions (onCollectionChange, onUpload, etc.).
    - Update `App.tsx` to use `AppSidebar`.

## 2. Layout Optimization
- **Goal**: Replace custom CSS layout with Tailwind CSS for better responsiveness and maintainability.
- **Current State**: `src/renderer/src/assets/main.css` contains custom CSS classes like `.app-shell`, `.app-sidebar`, `.app-main`, etc.
- **Action Items**:
    - Remove custom CSS classes from `main.css` and `App.tsx`.
    - Use Tailwind CSS utility classes for layout (e.g., `flex`, `h-screen`, `w-64`, `bg-gray-100`).
    - Ensure the layout is responsive and adapts to different screen sizes (though primarily desktop-focused).
    - Integrate `ThemeProvider` for consistent dark/light mode switching using Tailwind's `dark:` modifier if applicable, or stick to Ant Design's theme token usage where appropriate.

## 3. Chat UI Enhancement
- **Goal**: Improve visual presentation of chat area, bubbles, and prompts.
- **Current State**: Basic chat interface using `@ant-design/x` components.
- **Action Items**:
    - Customize `Bubble.List` and `Bubble` items for better readability and aesthetics.
    - Style the `Sender` component (input area) to be more prominent and user-friendly.
    - Improve the look of `Prompts` (quick questions) to be more inviting.
    - Ensure proper spacing and padding in the chat area.

## 4. Dialog Polish
- **Goal**: Improve `SettingsDialog` and Collection Modal UI.
- **Current State**: Functional but basic Ant Design modals/drawers.
- **Action Items**:
    - Review `SettingsDialog.tsx` and apply consistent styling.
    - Enhance the Collection Modal in `App.tsx` (or extract it if it becomes too complex) with better form layout and validation feedback.

## 5. Clean Up
- **Goal**: Remove unused code and optimize imports.
- **Action Items**:
    - Remove unused CSS from `main.css`.
    - Remove unused imports in `App.tsx` and other files.
    - Ensure consistent code style (Prettier/ESLint).
