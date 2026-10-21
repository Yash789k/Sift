// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only Explorer selection context. Real file payloads still arrive via OLE.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
class SelectionProbe {
  [STAThread] static void Main() {
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
