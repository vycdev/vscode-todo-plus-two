// Supply an image to the native macOS clipboard for the README capture.
// Preserve its original contents in memory and restore them on completion.
import AppKit
import Foundation

let board = NSPasteboard.general
let saved = (board.pasteboardItems ?? []).map { item in
  item.types.compactMap { type -> (NSPasteboard.PasteboardType, Data)? in
    guard let data = item.data(forType: type) else { return nil }
    return (type, data)
  }
}
let image = NSPasteboardItem()
image.setData(try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])), forType: .png)
board.clearContents()
guard board.writeObjects([image]) else { exit(1) }
let ownedCount = board.changeCount
print("ready")
fflush(stdout)
_ = readLine()
if board.changeCount == ownedCount {
  let items = saved.map { entries -> NSPasteboardItem in
    let item = NSPasteboardItem()
    for (type, data) in entries { item.setData(data, forType: type) }
    return item
  }
  board.clearContents()
  if !items.isEmpty { board.writeObjects(items) }
}
