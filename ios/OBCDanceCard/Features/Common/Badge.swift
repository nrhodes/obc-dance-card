//
//  Badge.swift
//  The small caption-weight capsule pill used to tag a row with one word or
//  short phrase — "Team" on a card row, "now a member" on a visitor, a
//  series' scoring/format on Programme, "no substitutes" — previously
//  duplicated identically across those four screens.
//

import SwiftUI

struct Badge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Color.secondary.opacity(0.15), in: Capsule())
    }
}
