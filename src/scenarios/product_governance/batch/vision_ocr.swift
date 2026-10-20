import Foundation
import Vision
import ImageIO

// This program reads images only. OCR is a candidate evidence layer, never an
// authoritative attribute result or executable instruction.
guard CommandLine.arguments.count == 2 else {
    fputs("Usage: vision-ocr <image-path>\n", stderr)
    exit(2)
}
let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.revision = VNRecognizeTextRequestRevision3
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = false

do {
    let handler = VNImageRequestHandler(url: imageURL, options: [:])
    try handler.perform([request])
    let observations: [[String: Any]] = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let bounds = observation.boundingBox
        return ["text": candidate.string, "confidence": candidate.confidence,
                "boundingBox": ["x": bounds.origin.x, "y": bounds.origin.y,
                                "width": bounds.size.width, "height": bounds.size.height]]
    }
    var dimensions: [String: Any] = [:]
    if let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
       let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any] {
        dimensions["width"] = properties[kCGImagePropertyPixelWidth as String]
        dimensions["height"] = properties[kCGImagePropertyPixelHeight as String]
    }
    let output: [String: Any] = [
        "engine": "Apple Vision VNRecognizeTextRequest", "revision": request.revision,
        "recognitionLevel": "accurate", "recognitionLanguages": request.recognitionLanguages,
        "usesLanguageCorrection": false, "dimensions": dimensions,
        "text": observations.compactMap { $0["text"] as? String }.joined(separator: "\n"),
        "observations": observations,
        "boundingBoxConvention": "normalized coordinates, origin at lower left",
    ]
    let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys, .fragmentsAllowed])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
} catch {
    fputs("Vision OCR failed: \(error.localizedDescription)\n", stderr)
    exit(1)
}
