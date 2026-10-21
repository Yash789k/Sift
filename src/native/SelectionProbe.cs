// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only Explorer selection context plus output refresh/icon placement mode.
// Real input file payloads still arrive via OLE; only saved Sift icons may move.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Threading;
using System.Text;
using Microsoft.Win32;
class SelectionProbe {
  [STAThread] static void Main(string[] args) {
    Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
    if (args.Length == 1 && args[0] == "--notify") { DesktopOutput.Run(); return; }
    var json = new JavaScriptSerializer();
    dynamic shell = null;
    try { shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application")); } catch { }
    string line;
    while ((line = Console.ReadLine()) != null) {
      var files = new List<string>();
      long handle = 0;
      var request = line.Split('|');
      string requestId = request.Length > 0 ? request[0] : "0";
      try {
        if (shell != null && request.Length == 3 && Int64.TryParse(request[1], out handle)) {
          dynamic windows = shell.Windows();
          try {
            foreach (dynamic window in windows) {
              try { if (Convert.ToInt64(window.HWND) == handle) ReadSelection(window, files); } catch { }
              finally { if (Marshal.IsComObject(window)) Marshal.ReleaseComObject(window); }
            }
            if (files.Count == 0 && request[2] == "1") {
              object location = 0, root = 0; int desktopHandle;
              dynamic desktop = windows.FindWindowSW(ref location, ref root, 8, out desktopHandle, 1);
              try { if (desktop != null) ReadSelection(desktop, files); } catch { }
              finally { if (desktop != null && Marshal.IsComObject(desktop)) Marshal.ReleaseComObject(desktop); }
            }
          } finally { if (Marshal.IsComObject(windows)) Marshal.ReleaseComObject(windows); }
        }
      } catch { }
      Console.WriteLine(json.Serialize(new { id = requestId, files = files }));
    }
    if (shell != null && Marshal.IsComObject(shell)) Marshal.ReleaseComObject(shell);
  }
  static void ReadSelection(dynamic window, List<string> files) {
    dynamic document = window.Document;
    dynamic selected = document.SelectedItems();
    try {
      foreach (dynamic item in selected) {
        try { string name = item.Path; if (File.Exists(name) && files.Count < 100) files.Add(name); }
        finally { if (Marshal.IsComObject(item)) Marshal.ReleaseComObject(item); }
      }
    } finally {
      if (Marshal.IsComObject(selected)) Marshal.ReleaseComObject(selected);
      if (Marshal.IsComObject(document)) Marshal.ReleaseComObject(document);
    }
  }
}

// Only successful Sift outputs passed by the main process are eligible. This
// separate, bounded process cannot delay drag selection or a saved conversion.
// COM chain follows Microsoft's desktop IFolderView example:
// https://devblogs.microsoft.com/oldnewthing/20130318-00/?p=4933
static class DesktopOutput {
  public class SavedOutput { public string source; public string path; }
  public class Request { public SavedOutput[] outputs; public bool repairExisting; public bool inspectDesktop; public bool inspectOnly; }
  public class Detail {
    public int index; public string status; public int[] sourcePosition; public int[] outputPosition; public int[] workArea; public int[] spacing;
  }
  public class Result {
    public int notified; public int placed; public int skipped;
    public bool iconsHidden; public bool? autoArrange; public bool desktopAvailable; public int iconCount;
    public Dictionary<string, int> reasons = new Dictionary<string, int>();
    public List<Detail> details = new List<Detail>();
  }
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; public Point(int x, int y) { this.x = x; this.y = y; } }
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public uint size; public Rect monitor, work; public uint flags; }
  [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IServiceProvider {
    [PreserveSig] int QueryService(ref Guid service, ref Guid iid, out IntPtr result);
  }
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int QueryView(IntPtr self, out IntPtr view);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetFolder(IntPtr self, ref Guid iid, out IntPtr folder);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetDisplayName(IntPtr self, uint kind, out IntPtr name);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetPoint(IntPtr self, IntPtr pidl, out Point point);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetSpacing(IntPtr self, out Point point);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetAutoArrange(IntPtr self);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetCount(IntPtr self, uint flags, out int count);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetItem(IntPtr self, int index, out IntPtr pidl);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int PositionItems(IntPtr self, uint count, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] pidls, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] Point[] positions, uint flags);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern void SHChangeNotify(int change, uint flags, [MarshalAs(UnmanagedType.LPWStr)] string item1, IntPtr item2);
  [DllImport("shell32.dll")] static extern int SHCreateItemWithParent(IntPtr parentId, IntPtr parent, IntPtr childId, ref Guid iid, out IntPtr item);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool GetClientRect(IntPtr window, out Rect rectangle);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point point, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("user32.dll")] static extern int MapWindowPoints(IntPtr from, IntPtr to, ref Rect rectangle, uint points);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  static T Method<T>(IntPtr instance, int slot) where T : class {
    return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(instance), slot * IntPtr.Size), typeof(T)) as T;
  }
  static void Release(IntPtr value) { if (value != IntPtr.Zero) Marshal.Release(value); }
  static void ReleaseObject(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
  static bool Same(string a, string b) { return String.Equals(a, b, StringComparison.OrdinalIgnoreCase); }
  static bool Absolute(string value) { return !String.IsNullOrWhiteSpace(value) && Path.IsPathRooted(value) && Path.GetPathRoot(value).Length > 1; }
  static bool HiddenSetting() {
    try {
      return Convert.ToInt32(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "HideIcons", 0)) != 0 ||
        Convert.ToInt32(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer", "NoDesktop", 0)) != 0 ||
        Convert.ToInt32(Registry.GetValue(@"HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer", "NoDesktop", 0)) != 0;
    } catch { return false; }
  }
  static bool OnDesktop(string value) {
    string parent = Path.GetDirectoryName(value);
    return Same(parent, Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)) ||
      Same(parent, Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory));
  }
  static void Reason(Result result, Detail detail, string reason) {
    detail.status = reason; result.skipped++;
    if (!result.reasons.ContainsKey(reason)) result.reasons[reason] = 0;
    result.reasons[reason]++;
  }
  sealed class View : IDisposable {
    public IntPtr browser, shellView, folderView, folder, window;
    object shell, windows, desktop;
    public View() {
      try {
        shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
        windows = ((dynamic)shell).Windows();
        object location = 0, reserved = null; int desktopHandle;
        desktop = ((dynamic)windows).FindWindowSW(ref location, ref reserved, 8, out desktopHandle, 1);
        if (desktop == null) throw new InvalidOperationException();
        Guid service = new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837"), browserId = new Guid("000214E2-0000-0000-C000-000000000046");
        Marshal.ThrowExceptionForHR(((IServiceProvider)desktop).QueryService(ref service, ref browserId, out browser));
        Marshal.ThrowExceptionForHR(Method<QueryView>(browser, 15)(browser, out shellView));
        Guid viewId = new Guid("CDE725B0-CCC9-4519-917E-325D72FAB4CE");
        Marshal.ThrowExceptionForHR(Marshal.QueryInterface(shellView, ref viewId, out folderView));
        Guid folderId = new Guid("000214E6-0000-0000-C000-000000000046");
        Marshal.ThrowExceptionForHR(Method<GetFolder>(folderView, 5)(folderView, ref folderId, out folder));
        Marshal.ThrowExceptionForHR(Method<QueryView>(shellView, 3)(shellView, out window));
      } catch { Dispose(); throw; }
    }
    public void Dispose() {
      Release(folder); folder = IntPtr.Zero; Release(folderView); folderView = IntPtr.Zero;
      Release(shellView); shellView = IntPtr.Zero; Release(browser); browser = IntPtr.Zero;
      ReleaseObject(desktop); desktop = null; ReleaseObject(windows); windows = null; ReleaseObject(shell); shell = null;
    }
    public List<Point> Positions() {
      var positions = new List<Point>(); int count;
      if (Method<GetCount>(folderView, 7)(folderView, 2 /* SVGIO_ALLVIEW */, out count) < 0) return positions;
      for (int i = 0; i < Math.Min(count, 5000); i++) {
        IntPtr pidl; if (Method<GetItem>(folderView, 6)(folderView, i, out pidl) < 0 || pidl == IntPtr.Zero) continue;
        try { Point point; if (Method<GetPoint>(folderView, 11)(folderView, pidl, out point) >= 0) positions.Add(point); }
        finally { Marshal.FreeCoTaskMem(pidl); }
      }
      return positions;
    }
    public IntPtr Find(string name) {
      // Use the view's exact child ID, not a filesystem-parsed absolute PIDL.
      // OneDrive/Desktop aggregation may wrap the item in another namespace.
      int count; if (Method<GetCount>(folderView, 7)(folderView, 2, out count) < 0) return IntPtr.Zero;
      Guid shellItemId = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
      for (int index = 0; index < Math.Min(count, 5000); index++) {
        IntPtr child; if (Method<GetItem>(folderView, 6)(folderView, index, out child) < 0 || child == IntPtr.Zero) continue;
        IntPtr item = IntPtr.Zero, text = IntPtr.Zero;
        try {
          if (SHCreateItemWithParent(IntPtr.Zero, folder, child, ref shellItemId, out item) >= 0 &&
              Method<GetDisplayName>(item, 5)(item, 0x80058000 /* SIGDN_FILESYSPATH */, out text) >= 0 && text != IntPtr.Zero &&
              Same(Marshal.PtrToStringUni(text), name)) {
            IntPtr found = child; child = IntPtr.Zero; return found;
          }
        } finally { if (text != IntPtr.Zero) Marshal.FreeCoTaskMem(text); Release(item); if (child != IntPtr.Zero) Marshal.FreeCoTaskMem(child); }
      }
      return IntPtr.Zero;
    }
  }
  static bool FreePosition(Point point, Point spacing, Rect bounds, List<Point> occupied) {
    if (point.x < bounds.left || point.y < bounds.top || point.x + spacing.x > bounds.right || point.y + spacing.y > bounds.bottom) return false;
    foreach (Point existing in occupied) if (Math.Abs(existing.x - point.x) < spacing.x && Math.Abs(existing.y - point.y) < spacing.y) return false;
    return true;
  }
  static bool Nearest(Point source, Point spacing, Rect bounds, List<Point> occupied, out Point destination) {
    // Prefer right, below, left, above, then progressively wider free rings.
    for (int radius = 1; radius <= 8; radius++) {
      int[,] preferred = { { radius, 0 }, { 0, radius }, { -radius, 0 }, { 0, -radius } };
      for (int i = 0; i < 4; i++) {
        var point = new Point(source.x + preferred[i, 0] * spacing.x, source.y + preferred[i, 1] * spacing.y);
        if (FreePosition(point, spacing, bounds, occupied)) { destination = point; return true; }
      }
      for (int y = -radius; y <= radius; y++) for (int x = -radius; x <= radius; x++) {
        if (Math.Max(Math.Abs(x), Math.Abs(y)) != radius || x == 0 || y == 0) continue;
        var point = new Point(source.x + x * spacing.x, source.y + y * spacing.y);
        if (FreePosition(point, spacing, bounds, occupied)) { destination = point; return true; }
      }
    }
    destination = source; return false;
  }
  static bool Position(View view, SavedOutput item, Detail detail, List<Point> occupied, bool inspectOnly) {
    IntPtr source = view.Find(item.source), output = IntPtr.Zero;
    try {
      if (source == IntPtr.Zero) { detail.status = "source-icon-not-found"; return false; }
      Point sourcePoint, outputPoint = new Point();
      if (Method<GetPoint>(view.folderView, 11)(view.folderView, source, out sourcePoint) < 0) { detail.status = "source-icon-not-found"; return false; }
      // The asynchronous shell notification may not have reached the view yet.
      bool found = false;
      for (int retry = 0; retry < 6; retry++) {
        if (output == IntPtr.Zero) output = view.Find(item.path);
        if (output != IntPtr.Zero && Method<GetPoint>(view.folderView, 11)(view.folderView, output, out outputPoint) >= 0) { found = true; break; }
        Thread.Sleep(80);
      }
      if (!found) { detail.status = "output-icon-not-found"; return false; }
      Point spacing; if (Method<GetSpacing>(view.folderView, 12)(view.folderView, out spacing) < 0 || spacing.x <= 0 || spacing.y <= 0) {
        if (Method<GetSpacing>(view.folderView, 13)(view.folderView, out spacing) < 0 || spacing.x <= 0 || spacing.y <= 0) { detail.status = "spacing-unavailable"; return false; }
      }
      Rect bounds; if (!GetClientRect(view.window, out bounds)) { detail.status = "view-bounds-unavailable"; return false; }
      Point screenPoint = sourcePoint; if (!ClientToScreen(view.window, ref screenPoint)) { detail.status = "view-bounds-unavailable"; return false; }
      var monitor = new MonitorInfo { size = (uint)Marshal.SizeOf(typeof(MonitorInfo)) };
      if (!GetMonitorInfo(MonitorFromPoint(screenPoint, 0), ref monitor)) { detail.status = "source-monitor-unavailable"; return false; }
      Rect work = monitor.work; MapWindowPoints(IntPtr.Zero, view.window, ref work, 2);
      bounds.left = Math.Max(bounds.left, work.left); bounds.top = Math.Max(bounds.top, work.top);
      bounds.right = Math.Min(bounds.right, work.right); bounds.bottom = Math.Min(bounds.bottom, work.bottom);
      detail.workArea = new int[] { bounds.left, bounds.top, bounds.right, bounds.bottom };
      detail.spacing = new int[] { spacing.x, spacing.y };
      if (inspectOnly) {
        detail.sourcePosition = new int[] { sourcePoint.x, sourcePoint.y }; detail.outputPosition = new int[] { outputPoint.x, outputPoint.y };
        detail.status = "observed"; return true;
      }
      // Ignore just this output's old slot; never rearrange any other icon.
      Point oldPosition = outputPoint; int oldIndex = occupied.FindIndex(p => p.x == oldPosition.x && p.y == oldPosition.y);
      var candidates = new List<Point>(occupied); if (oldIndex >= 0) candidates.RemoveAt(oldIndex);
      double distance = Math.Abs(outputPoint.x - sourcePoint.x) / (double)spacing.x + Math.Abs(outputPoint.y - sourcePoint.y) / (double)spacing.y;
      if (distance > .8 && distance < 1.15 && FreePosition(outputPoint, spacing, bounds, candidates)) {
        detail.sourcePosition = new int[] { sourcePoint.x, sourcePoint.y }; detail.outputPosition = new int[] { outputPoint.x, outputPoint.y };
        detail.status = "already-adjacent"; return true;
      }
      Point destination; if (!Nearest(sourcePoint, spacing, bounds, candidates, out destination)) { detail.status = "no-free-nearby-slot"; return false; }
      // Preserve user's selection, focus, auto-arrange and snap-to-grid settings.
      int hr = Method<PositionItems>(view.folderView, 16)(view.folderView, 1, new IntPtr[] { output }, new Point[] { destination }, 0xC0000080);
      if (hr < 0) { detail.status = "placement-declined"; return false; }
      Thread.Sleep(35);
      if (Method<GetPoint>(view.folderView, 11)(view.folderView, output, out outputPoint) < 0) {
        occupied.Clear(); occupied.AddRange(view.Positions()); detail.status = "placement-unconfirmed"; return false;
      }
      if (oldIndex >= 0) occupied.RemoveAt(oldIndex); occupied.Add(outputPoint);
      if (Math.Abs(outputPoint.x - destination.x) > 4 || Math.Abs(outputPoint.y - destination.y) > 4) { detail.status = "placement-unconfirmed"; return false; }
      detail.sourcePosition = new int[] { sourcePoint.x, sourcePoint.y };
      detail.outputPosition = new int[] { outputPoint.x, outputPoint.y }; detail.status = "placed"; return true;
    } finally { if (source != IntPtr.Zero) Marshal.FreeCoTaskMem(source); if (output != IntPtr.Zero) Marshal.FreeCoTaskMem(output); }
  }
  public static void Run() {
    var result = new Result(); var serializer = new JavaScriptSerializer();
    try {
      // Local helper coordinate mode only; no user display settings are changed.
      try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
      string line = Console.ReadLine();
      if (line == null || line.Length > 512000) throw new InvalidOperationException();
      Request request = serializer.Deserialize<Request>(line);
      var desktopItems = new List<KeyValuePair<SavedOutput, Detail>>(); var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      result.iconsHidden = HiddenSetting();
      SavedOutput[] items = request == null || request.outputs == null ? new SavedOutput[0] : request.outputs;
      for (int index = 0; index < Math.Min(items.Length, 300); index++) {
        SavedOutput item = items[index]; var detail = new Detail { index = index }; result.details.Add(detail);
        try {
          if (item == null || !Absolute(item.path)) { Reason(result, detail, "invalid-output"); continue; }
          item.path = Path.GetFullPath(item.path);
          if (!File.Exists(item.path)) { Reason(result, detail, "output-missing"); continue; }
          if (!String.IsNullOrWhiteSpace(item.source) && Absolute(item.source)) item.source = Path.GetFullPath(item.source);
          if (Same(item.path, item.source)) { Reason(result, detail, "original-protected"); continue; }
          if (!request.inspectOnly) {
            SHChangeNotify(2 /* CREATE */, 0x3005 /* PATHW | FLUSHNOWAIT */, item.path, IntPtr.Zero);
            result.notified++; directories.Add(Path.GetDirectoryName(item.path));
          }
          if (!OnDesktop(item.path)) { Reason(result, detail, "outside-desktop"); continue; }
          if (!Absolute(item.source) || !File.Exists(item.source) || !OnDesktop(item.source)) { Reason(result, detail, "source-not-on-desktop"); continue; }
          if (!Path.GetFileNameWithoutExtension(item.path).StartsWith(Path.GetFileNameWithoutExtension(item.source) + "-", StringComparison.OrdinalIgnoreCase)) { Reason(result, detail, "output-name-unrecognized"); continue; }
          if (!request.repairExisting && File.GetCreationTimeUtc(item.path) < DateTime.UtcNow.AddMinutes(-5)) { Reason(result, detail, "output-not-new"); continue; }
          desktopItems.Add(new KeyValuePair<SavedOutput, Detail>(item, detail));
        } catch { Reason(result, detail, "output-unavailable"); }
      }
      foreach (string directory in directories) SHChangeNotify(0x1000 /* UPDATEDIR */, 0x3005, directory, IntPtr.Zero);
      if (desktopItems.Count > 0 || request != null && request.inspectDesktop) {
        try {
          using (var view = new View()) {
            result.desktopAvailable = true;
            int arranged = Method<GetAutoArrange>(view.folderView, 14)(view.folderView);
            result.autoArrange = arranged == 0 ? (bool?)true : arranged == 1 ? (bool?)false : null;
            result.iconsHidden = result.iconsHidden || !IsWindowVisible(view.window);
            List<Point> occupied = view.Positions();
            result.iconCount = occupied.Count;
            var deadline = DateTime.UtcNow.AddSeconds(3);
            foreach (var entry in desktopItems) {
              if (!request.inspectOnly && result.iconsHidden) Reason(result, entry.Value, "desktop-icons-hidden");
              else if (!request.inspectOnly && result.autoArrange != false) Reason(result, entry.Value, arranged == 0 ? "auto-arrange" : "arrangement-unavailable");
              else if (DateTime.UtcNow > deadline) Reason(result, entry.Value, "placement-time-limit");
              else if (Position(view, entry.Key, entry.Value, occupied, request.inspectOnly)) { if (!request.inspectOnly) result.placed++; }
              else Reason(result, entry.Value, entry.Value.status ?? "placement-unavailable");
            }
          }
        } catch {
          if (desktopItems.Count == 0) result.reasons["desktop-view-unavailable"] = 1;
          foreach (var entry in desktopItems) if (String.IsNullOrEmpty(entry.Value.status)) Reason(result, entry.Value, "desktop-view-unavailable");
        }
      }
    } catch { result.reasons["invalid-request"] = 1; }
    Console.WriteLine(serializer.Serialize(result));
  }
}
